import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  WEBHOOK_RATE_LIMIT_DEFAULTS,
  createAuthRateLimiter,
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
  resolveLoggerBackedRuntime,
  runStoppablePassiveMonitor,
} from "../runtime-api.js";
import { resolveRestChannelAccount } from "./accounts.js";
import { handleRestChannelInbound } from "./inbound.js";
import { getRestChannelRuntime } from "./runtime.js";
import type {
  CoreConfig,
  RestChannelInboundMessage,
  RestChannelWebhookServerOptions,
} from "./types.js";

const DEFAULT_WEBHOOK_PORT = 8789;
const DEFAULT_WEBHOOK_HOST = "0.0.0.0";
const DEFAULT_WEBHOOK_PATH = "/rest-channel-webhook";
const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 512; // 512 KB
const PREAUTH_MAX_BODY_BYTES = 64 * 1024;
const PREAUTH_BODY_TIMEOUT_MS = 5_000;
const POST_AUTH_BODY_TIMEOUT_MS = 30_000;
const WEBHOOK_AUTH_RATE_LIMIT_SCOPE = "rest-channel-webhook-auth";
const HEALTH_PATH = "/healthz";

type RuntimeEnvImport = import("openclaw/plugin-sdk/rest-channel").RuntimeEnv;

const WEBHOOK_ERRORS = {
  unauthorizedMissing: "Unauthorized: missing or invalid auth credentials",
  invalidPayload: "Invalid payload: expected { from, text } JSON object",
  payloadTooLarge: "Payload too large",
  internalError: "Internal server error",
} as const;

function writeJsonResponse(
  res: ServerResponse,
  status: number,
  body?: Record<string, unknown>,
): void {
  if (body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(status);
  res.end();
}

function writeError(res: ServerResponse, status: number, error: string): void {
  if (!res.headersSent) {
    writeJsonResponse(res, status, { error });
  }
}

/**
 * Returns true when the inbound request passes authentication, false otherwise.
 * Writes a 401 response and returns false on failure.
 */
function verifyInboundAuth(params: {
  req: IncomingMessage;
  res: ServerResponse;
  authMethod: string;
  apiKey: string;
  apiKeyHeader: string;
  bearerToken: string;
  clientIp: string;
  authRateLimiter: ReturnType<typeof createAuthRateLimiter>;
}): boolean {
  const { req, res, authMethod, apiKey, apiKeyHeader, bearerToken, clientIp, authRateLimiter } =
    params;

  if (authMethod === "none") {
    return true;
  }

  let authenticated = false;

  if (authMethod === "api-key" && apiKey) {
    const headerValue = req.headers[apiKeyHeader.toLowerCase()];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    authenticated = provided?.trim() === apiKey;
  } else if (authMethod === "bearer" && bearerToken) {
    const authHeader = req.headers["authorization"] ?? "";
    const provided = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    authenticated = provided?.trim() === `Bearer ${bearerToken}`;
  }

  if (!authenticated) {
    authRateLimiter.recordFailure(clientIp, WEBHOOK_AUTH_RATE_LIMIT_SCOPE);
    writeError(res, 401, WEBHOOK_ERRORS.unauthorizedMissing);
    return false;
  }

  authRateLimiter.reset(clientIp, WEBHOOK_AUTH_RATE_LIMIT_SCOPE);
  return true;
}

/**
 * Parse the raw request body into a RestChannelInboundMessage.
 * Returns null and writes a 400 response on failure.
 */
function parseInboundBody(
  body: string,
  res: ServerResponse,
): RestChannelInboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    writeError(res, 400, WEBHOOK_ERRORS.invalidPayload);
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    writeError(res, 400, WEBHOOK_ERRORS.invalidPayload);
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const from = typeof obj.from === "string" ? obj.from.trim() : "";
  const text = typeof obj.text === "string" ? obj.text.trim() : "";

  if (!from || !text) {
    writeError(res, 400, WEBHOOK_ERRORS.invalidPayload);
    return null;
  }

  return {
    from,
    text,
    to: typeof obj.to === "string" ? obj.to.trim() || undefined : undefined,
    threadId: typeof obj.threadId === "string" ? obj.threadId.trim() || undefined : undefined,
    timestamp: Date.now(),
    messageId: randomUUID(),
  };
}

export function createRestChannelWebhookServer(opts: RestChannelWebhookServerOptions): {
  server: Server;
  start: () => Promise<void>;
  stop: () => void;
} {
  const {
    port,
    host,
    path,
    inboundAuthMethod,
    inboundApiKey = "",
    inboundApiKeyHeader = "X-Api-Key",
    inboundBearerToken = "",
    onMessage,
    onError,
    abortSignal,
  } = opts;

  const maxBodyBytes =
    typeof opts.maxBodyBytes === "number" && opts.maxBodyBytes > 0
      ? Math.min(opts.maxBodyBytes, DEFAULT_WEBHOOK_MAX_BODY_BYTES)
      : DEFAULT_WEBHOOK_MAX_BODY_BYTES;

  const authRateLimiter = createAuthRateLimiter({
    maxAttempts: WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests,
    windowMs: WEBHOOK_RATE_LIMIT_DEFAULTS.windowMs,
    lockoutMs: WEBHOOK_RATE_LIMIT_DEFAULTS.windowMs,
    exemptLoopback: false,
    pruneIntervalMs: WEBHOOK_RATE_LIMIT_DEFAULTS.windowMs,
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === HEALTH_PATH) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.url !== path || req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }

    const clientIp = req.socket.remoteAddress ?? "unknown";
    if (!authRateLimiter.check(clientIp, WEBHOOK_AUTH_RATE_LIMIT_SCOPE).allowed) {
      res.writeHead(429);
      res.end("Too Many Requests");
      return;
    }

    try {
      // Read a small pre-auth slice to verify auth headers before parsing full body.
      const preAuthBody = await readRequestBodyWithLimit(req, {
        maxBytes: PREAUTH_MAX_BODY_BYTES,
        timeoutMs: PREAUTH_BODY_TIMEOUT_MS,
      });

      const authed = verifyInboundAuth({
        req,
        res,
        authMethod: inboundAuthMethod,
        apiKey: inboundApiKey,
        apiKeyHeader: inboundApiKeyHeader,
        bearerToken: inboundBearerToken,
        clientIp,
        authRateLimiter,
      });
      if (!authed) {
        return;
      }

      // Auth passed — if payload was truncated, re-read with the full limit.
      let bodyStr = preAuthBody;
      if (preAuthBody.length >= PREAUTH_MAX_BODY_BYTES) {
        bodyStr = await readRequestBodyWithLimit(req, {
          maxBytes: maxBodyBytes,
          timeoutMs: POST_AUTH_BODY_TIMEOUT_MS,
        });
      }

      const message = parseInboundBody(bodyStr, res);
      if (!message) {
        return;
      }

      // Acknowledge immediately before dispatching to avoid client timeouts.
      writeJsonResponse(res, 200, { ok: true, messageId: message.messageId });

      try {
        await onMessage(message);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    } catch (err) {
      if (isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE")) {
        writeError(res, 413, WEBHOOK_ERRORS.payloadTooLarge);
        return;
      }
      if (isRequestBodyLimitError(err, "REQUEST_BODY_TIMEOUT")) {
        writeError(res, 408, requestBodyErrorToText("REQUEST_BODY_TIMEOUT"));
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
      writeError(res, 500, WEBHOOK_ERRORS.internalError);
    }
  });

  const start = (): Promise<void> =>
    new Promise((resolve) => {
      server.listen(port, host, () => resolve());
    });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      server.close();
    } catch {
      // ignore close races
    }
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      stop();
    } else {
      abortSignal.addEventListener("abort", stop, { once: true });
    }
  }

  return { server, start, stop };
}

export type RestChannelMonitorOptions = {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnvImport;
  abortSignal?: AbortSignal;
  onMessage?: (message: RestChannelInboundMessage) => Promise<void>;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export async function monitorRestChannelProvider(
  opts: RestChannelMonitorOptions,
): Promise<{ stop: () => void }> {
  const core = getRestChannelRuntime();
  const cfg = opts.config ?? (core.config.loadConfig() as CoreConfig);
  const account = resolveRestChannelAccount({ cfg, accountId: opts.accountId });
  const runtime = resolveLoggerBackedRuntime(opts.runtime, core.logging.getChildLogger());

  const port = account.config.webhookPort ?? DEFAULT_WEBHOOK_PORT;
  const host = account.config.webhookHost ?? DEFAULT_WEBHOOK_HOST;
  const path = account.config.webhookPath ?? DEFAULT_WEBHOOK_PATH;

  const logger = core.logging.getChildLogger({
    channel: "rest-channel",
    accountId: account.accountId,
  });

  const { start, stop } = createRestChannelWebhookServer({
    port,
    host,
    path,
    inboundAuthMethod: account.inboundAuthMethod,
    inboundApiKey: account.inboundApiKey,
    inboundApiKeyHeader: account.inboundApiKeyHeader,
    inboundBearerToken: account.inboundBearerToken,
    onMessage: async (message) => {
      core.channel.activity.record({
        channel: "rest-channel",
        accountId: account.accountId,
        direction: "inbound",
        at: message.timestamp,
      });
      if (opts.onMessage) {
        await opts.onMessage(message);
        return;
      }
      await handleRestChannelInbound({
        message,
        account,
        config: cfg,
        runtime,
        statusSink: opts.statusSink,
      });
    },
    onError: (error) => {
      logger.error(`[rest-channel:${account.accountId}] webhook error: ${error.message}`);
    },
    abortSignal: opts.abortSignal,
  });

  if (opts.abortSignal?.aborted) {
    return { stop };
  }

  await start();

  if (opts.abortSignal?.aborted) {
    stop();
    return { stop };
  }

  const publicUrl =
    account.config.webhookPublicUrl ??
    `http://${host === "0.0.0.0" ? "localhost" : host}:${port}${path}`;
  logger.info(`[rest-channel:${account.accountId}] webhook listening on ${publicUrl}`);

  return { stop };
}
