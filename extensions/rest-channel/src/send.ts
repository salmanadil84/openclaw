import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/rest-channel";
import { resolveRestChannelAccount } from "./accounts.js";
import { stripRestChannelTargetPrefix } from "./normalize.js";
import { getRestChannelRuntime } from "./runtime.js";
import type { CoreConfig, RestChannelOutboundBody, RestChannelSendResult } from "./types.js";

type SendOptions = {
  accountId?: string;
  cfg?: CoreConfig;
  replyToId?: string | null;
  threadId?: string | number | null;
};

function buildAuthHeaders(
  method: string,
  apiKey: string,
  apiKeyHeader: string,
  bearerToken: string,
): Record<string, string> {
  if (method === "api-key" && apiKey) {
    return { [apiKeyHeader]: apiKey };
  }
  if (method === "bearer" && bearerToken) {
    return { Authorization: `Bearer ${bearerToken}` };
  }
  return {};
}

export async function sendMessageRestChannel(
  to: string,
  text: string,
  opts: SendOptions = {},
): Promise<RestChannelSendResult> {
  const core = getRestChannelRuntime();
  const cfg = (opts.cfg ?? core.config.loadConfig()) as CoreConfig;
  const account = resolveRestChannelAccount({ cfg, accountId: opts.accountId });

  if (!account.outboundUrl) {
    throw new Error(
      `REST channel outboundUrl not configured for account "${account.accountId}". ` +
        `Set channels.rest-channel.outboundUrl in your config.`,
    );
  }

  const senderId = stripRestChannelTargetPrefix(to);
  if (!senderId) {
    throw new Error("REST channel: recipient (to) must be non-empty");
  }

  if (!text?.trim()) {
    throw new Error("REST channel: message text must be non-empty");
  }

  const threadId =
    opts.threadId != null && opts.threadId !== "" ? String(opts.threadId) : undefined;
  const replyToId = opts.replyToId ?? undefined;

  const body: RestChannelOutboundBody = {
    from: "openclaw",
    to: senderId,
    text: text.trim(),
    channel: "rest-channel",
    timestamp: Date.now(),
    ...(threadId ? { threadId } : {}),
    ...(replyToId ? { replyToId } : {}),
  };

  const authHeaders = buildAuthHeaders(
    account.outboundAuthMethod,
    account.outboundApiKey,
    account.outboundApiKeyHeader,
    account.outboundBearerToken,
  );

  const { response, release } = await fetchWithSsrFGuard({
    url: account.outboundUrl,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(body),
    },
    auditContext: "rest-channel-send",
    policy: account.config.allowPrivateNetwork ? { allowPrivateNetwork: true } : undefined,
  });

  try {
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const status = response.status;
      let errorMsg = `REST channel send failed (${status})`;
      if (status === 401) {
        errorMsg =
          "REST channel: authentication failed — check outboundApiKey or outboundBearerToken";
      } else if (status === 403) {
        errorMsg = "REST channel: forbidden — the remote endpoint rejected the request";
      } else if (status === 404) {
        errorMsg = `REST channel: outboundUrl not found (${account.outboundUrl})`;
      } else if (errorBody) {
        errorMsg = `REST channel send failed: ${errorBody}`;
      }
      throw new Error(errorMsg);
    }

    let messageId = `rest-${Date.now()}`;
    try {
      const data = (await response.json()) as { messageId?: string; id?: string };
      if (data.messageId) {
        messageId = data.messageId;
      } else if (data.id) {
        messageId = String(data.id);
      }
    } catch {
      // Response parsing failed; message was delivered.
    }

    return { messageId, to: senderId };
  } finally {
    await release();
  }
}
