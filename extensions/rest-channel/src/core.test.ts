import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/bundled-channel-config-runtime.js", () => ({
  getBundledChannelRuntimeMap: () => new Map(),
  getBundledChannelConfigSchemaMap: () => new Map(),
}));

vi.mock("../../../src/channels/plugins/bundled.js", () => ({
  bundledChannelPlugins: [],
  bundledChannelSetupPlugins: [],
}));

const fetchWithSsrFGuard = vi.hoisted(() => vi.fn());

vi.mock("../runtime-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime-api.js")>();
  return {
    ...actual,
    fetchWithSsrFGuard,
  };
});

vi.mock("openclaw/plugin-sdk/ssrf-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/ssrf-runtime")>();
  return {
    ...actual,
    fetchWithSsrFGuard,
  };
});

import {
  looksLikeRestChannelTargetId,
  normalizeRestChannelMessagingTarget,
  stripRestChannelTargetPrefix,
} from "./normalize.js";
import { RestChannelConfigSchema } from "./config-schema.js";
import { resolveRestChannelOutboundSessionRoute } from "./session-route.js";

let restChannelPlugin: typeof import("./channel.js").restChannelPlugin;

beforeEach(async () => {
  vi.resetModules();
  ({ restChannelPlugin } = await import("./channel.js"));
});

describe("normalize", () => {
  it("strips rest-channel, rest, and http-channel prefixes", () => {
    expect(stripRestChannelTargetPrefix("rest-channel:user123")).toBe("user123");
    expect(stripRestChannelTargetPrefix("rest:user123")).toBe("user123");
    expect(stripRestChannelTargetPrefix("http-channel:user123")).toBe("user123");
    expect(stripRestChannelTargetPrefix("REST-CHANNEL:User123")).toBe("User123");
  });

  it("returns the original value when no prefix is present", () => {
    expect(stripRestChannelTargetPrefix("user123")).toBe("user123");
  });

  it("trims surrounding whitespace", () => {
    expect(stripRestChannelTargetPrefix("  rest-channel:  user123  ")).toBe("user123");
  });

  it("normalizeRestChannelMessagingTarget strips prefix", () => {
    expect(normalizeRestChannelMessagingTarget("rest-channel:user123")).toBe("user123");
    expect(normalizeRestChannelMessagingTarget("user123")).toBe("user123");
  });

  it("looksLikeRestChannelTargetId returns true for non-empty targets", () => {
    expect(looksLikeRestChannelTargetId("user123")).toBe(true);
    expect(looksLikeRestChannelTargetId("rest-channel:user123")).toBe(true);
    expect(looksLikeRestChannelTargetId("rest:sensor-1")).toBe(true);
  });

  it("looksLikeRestChannelTargetId returns false for empty and whitespace-only strings", () => {
    expect(looksLikeRestChannelTargetId("")).toBe(false);
    expect(looksLikeRestChannelTargetId("  ")).toBe(false);
    expect(looksLikeRestChannelTargetId("rest-channel:")).toBe(false);
  });
});

describe("session route", () => {
  it("builds a direct outbound session route for a plain sender id", () => {
    const route = resolveRestChannelOutboundSessionRoute({
      cfg: {},
      agentId: "main",
      accountId: "default",
      target: "user123",
    });

    expect(route).toMatchObject({
      peer: { kind: "direct", id: "user123" },
      from: "rest-channel:user123",
      to: "user:user123",
    });
  });

  it("strips channel prefix before building the route", () => {
    const route = resolveRestChannelOutboundSessionRoute({
      cfg: {},
      agentId: "main",
      accountId: "default",
      target: "rest-channel:my-sender",
    });

    expect(route).toMatchObject({
      peer: { kind: "direct", id: "my-sender" },
      from: "rest-channel:my-sender",
    });
  });

  it("returns null for an empty target", () => {
    expect(
      resolveRestChannelOutboundSessionRoute({
        cfg: {},
        agentId: "main",
        accountId: "default",
        target: "",
      }),
    ).toBeNull();
  });

  it("returns null when target reduces to empty after prefix strip", () => {
    expect(
      resolveRestChannelOutboundSessionRoute({
        cfg: {},
        agentId: "main",
        accountId: "default",
        target: "rest-channel:",
      }),
    ).toBeNull();
  });
});

describe("config schema", () => {
  it("accepts a minimal valid config with just outboundUrl", () => {
    expect(
      RestChannelConfigSchema.safeParse({ outboundUrl: "https://example.com/reply" }).success,
    ).toBe(true);
  });

  it("accepts an empty config object (all fields optional)", () => {
    expect(RestChannelConfigSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a SecretRef for outboundApiKey", () => {
    const result = RestChannelConfigSchema.safeParse({
      outboundUrl: "https://example.com/reply",
      outboundAuthMethod: "api-key",
      outboundApiKey: {
        source: "env",
        provider: "default",
        id: "REST_CHANNEL_OUTBOUND_API_KEY",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a SecretRef for inboundApiKey", () => {
    const result = RestChannelConfigSchema.safeParse({
      inboundAuthMethod: "api-key",
      inboundApiKey: {
        source: "env",
        provider: "default",
        id: "REST_CHANNEL_INBOUND_API_KEY",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid outboundUrl", () => {
    expect(
      RestChannelConfigSchema.safeParse({ outboundUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("rejects an invalid authMethod value", () => {
    expect(
      RestChannelConfigSchema.safeParse({ outboundAuthMethod: "jwt" }).success,
    ).toBe(false);
  });

  it("accepts per-account overrides under accounts", () => {
    const result = RestChannelConfigSchema.safeParse({
      outboundUrl: "https://example.com/default",
      accounts: {
        secondary: { outboundUrl: "https://secondary.example.com/reply" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts webhookPort as a positive integer", () => {
    expect(
      RestChannelConfigSchema.safeParse({ webhookPort: 8789 }).success,
    ).toBe(true);
  });

  it("rejects webhookPort that is not a positive integer", () => {
    expect(RestChannelConfigSchema.safeParse({ webhookPort: -1 }).success).toBe(false);
    expect(RestChannelConfigSchema.safeParse({ webhookPort: 0 }).success).toBe(false);
  });
});

describe("channel plugin shape", () => {
  it("has the expected id and meta label", () => {
    expect(restChannelPlugin.id).toBe("rest-channel");
  });

  it("declares only direct chat type", () => {
    expect(restChannelPlugin.capabilities?.chatTypes).toEqual(["direct"]);
  });

  it("does not advertise reactions, threads, or media", () => {
    expect(restChannelPlugin.capabilities?.reactions).toBe(false);
    expect(restChannelPlugin.capabilities?.threads).toBe(false);
    expect(restChannelPlugin.capabilities?.media).toBe(false);
  });

  it("has a security resolveDmPolicy function", () => {
    expect(typeof restChannelPlugin.security?.resolveDmPolicy).toBe("function");
  });

  it("normalizes DM allowlist entries by stripping channel prefixes", () => {
    const normalize = restChannelPlugin.pairing?.normalizeAllowEntry;
    if (!normalize) throw new Error("normalizeAllowEntry unavailable");

    expect(normalize("  rest-channel:User123  ")).toBe("User123");
    expect(normalize("rest:User456")).toBe("User456");
    expect(normalize("http-channel:User789")).toBe("User789");
    expect(normalize("plain-id")).toBe("plain-id");
  });
});
