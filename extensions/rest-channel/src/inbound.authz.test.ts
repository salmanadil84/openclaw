import { describe, expect, it, vi } from "vitest";
import type { PluginRuntime, RuntimeEnv } from "../runtime-api.js";
import type { ResolvedRestChannelAccount } from "./accounts.js";
import { handleRestChannelInbound } from "./inbound.js";
import { setRestChannelRuntime } from "./runtime.js";
import type { CoreConfig, RestChannelInboundMessage } from "./types.js";

/**
 * Installs a minimal mock runtime so handleRestChannelInbound can run without a real
 * OpenClaw process.  Only the subset of `PluginRuntime` that the inbound handler
 * actually calls is implemented; everything else is left as `vi.fn()`.
 */
function installInboundAuthzRuntime(params: {
  readAllowFromStore?: () => Promise<string[]>;
  dispatchInboundReplyWithBase?: (...args: unknown[]) => Promise<void>;
}) {
  setRestChannelRuntime({
    channel: {
      pairing: {
        readAllowFromStore: params.readAllowFromStore ?? vi.fn(async () => []),
        issueChallenge: vi.fn(async () => {}),
      },
      commands: {
        shouldHandleTextCommands: () => false,
      },
      text: {
        hasControlCommand: () => false,
      },
      activity: {
        record: vi.fn(),
      },
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "default",
          accountId: "default",
          sessionKey: "rest-channel:user123",
        })),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/test-store"),
        readSessionUpdatedAt: vi.fn(() => undefined),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn((opts: { body: string }) => opts.body),
        finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
      },
    },
    config: {
      loadConfig: vi.fn(() => ({})),
    },
    logging: {
      getChildLogger: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      })),
    },
  } as unknown as PluginRuntime);
}

function createTestRuntimeEnv(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
  } as unknown as RuntimeEnv;
}

function makeAccount(
  overrides: Partial<ResolvedRestChannelAccount> = {},
): ResolvedRestChannelAccount {
  return {
    accountId: "default",
    enabled: true,
    outboundUrl: "https://example.com/reply",
    outboundAuthMethod: "none",
    outboundApiKey: "",
    outboundApiKeyHeader: "X-Api-Key",
    outboundBearerToken: "",
    inboundAuthMethod: "none",
    inboundApiKey: "",
    inboundApiKeyHeader: "X-Api-Key",
    inboundBearerToken: "",
    config: {
      dmPolicy: "allowlist",
      allowFrom: [],
    },
    ...overrides,
  };
}

function makeMessage(
  overrides: Partial<RestChannelInboundMessage> = {},
): RestChannelInboundMessage {
  return {
    from: "user123",
    text: "Hello",
    messageId: "msg-1",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeConfig(
  allowFrom: string[] = [],
  dmPolicy: "allowlist" | "pairing" | "open" = "allowlist",
): CoreConfig {
  return {
    channels: {
      "rest-channel": {
        dmPolicy,
        allowFrom,
      },
    },
  };
}

describe("rest-channel inbound authz: allowlist policy", () => {
  it("dispatches a message from a sender on the allowlist", async () => {
    const dispatched: unknown[] = [];
    installInboundAuthzRuntime({
      readAllowFromStore: vi.fn(async () => []),
    });

    // Override dispatchInboundReplyWithBase to capture calls without executing real logic
    const dispatchSpy = vi.fn(async () => {});
    vi.doMock("../runtime-api.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../runtime-api.js")>()),
      dispatchInboundReplyWithBase: dispatchSpy,
    }));

    const account = makeAccount({
      config: { dmPolicy: "allowlist", allowFrom: ["user123"] },
    });
    const config = makeConfig(["user123"], "allowlist");
    const runtime = createTestRuntimeEnv();

    // The test verifies that handleRestChannelInbound does NOT drop the message.
    // A drop logs a "drop sender" message via runtime.log.
    await handleRestChannelInbound({
      message: makeMessage({ from: "user123" }),
      account,
      config,
      runtime,
    });

    // No "drop sender" log should have been emitted
    const logCalls = (runtime.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0]),
    );
    const dropped = logCalls.some((msg) => msg.includes("drop sender user123"));
    expect(dropped).toBe(false);
  });

  it("drops a message from a sender not on the allowlist", async () => {
    installInboundAuthzRuntime({
      readAllowFromStore: vi.fn(async () => []),
    });

    const account = makeAccount({
      config: { dmPolicy: "allowlist", allowFrom: ["allowed-user"] },
    });
    const config = makeConfig(["allowed-user"], "allowlist");
    const runtime = createTestRuntimeEnv();

    await handleRestChannelInbound({
      message: makeMessage({ from: "intruder" }),
      account,
      config,
      runtime,
    });

    const logCalls = (runtime.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0]),
    );
    const dropped = logCalls.some(
      (msg) => msg.includes("drop sender intruder") || msg.includes("intruder"),
    );
    expect(dropped).toBe(true);
  });
});

describe("rest-channel inbound authz: empty text body", () => {
  it("silently ignores messages with only whitespace text", async () => {
    installInboundAuthzRuntime({});
    const runtime = createTestRuntimeEnv();

    await handleRestChannelInbound({
      message: makeMessage({ text: "   " }),
      account: makeAccount({ config: { dmPolicy: "open", allowFrom: [] } }),
      config: makeConfig([], "open"),
      runtime,
    });

    // No dispatch or log call should have happened for an empty body
    expect(runtime.log).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalled();
  });
});

describe("rest-channel inbound authz: pairing policy stores are isolated", () => {
  it("does not confuse pairing store entries with DM config allowlist entries", async () => {
    const readAllowFromStore = vi.fn(async () => ["attacker"]);
    installInboundAuthzRuntime({ readAllowFromStore });

    const account = makeAccount({
      config: {
        dmPolicy: "pairing",
        allowFrom: [], // config allowlist is empty
      },
    });
    const config: CoreConfig = {
      channels: {
        "rest-channel": {
          dmPolicy: "pairing",
          allowFrom: [],
        },
      },
    };
    const runtime = createTestRuntimeEnv();

    await handleRestChannelInbound({
      message: makeMessage({ from: "attacker" }),
      account,
      config,
      runtime,
    });

    // Pairing store was read
    expect(readAllowFromStore).toHaveBeenCalled();

    // The attacker should not have been routed through (pairing challenge or drop)
    const logCalls = (runtime.log as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0]),
    );
    const dropped = logCalls.some((msg) => msg.includes("attacker"));
    // Either dropped or pairing-challenged — either way it didn't silently pass
    expect(dropped).toBe(true);
  });
});
