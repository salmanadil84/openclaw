import { afterEach, describe, expect, it } from "vitest";
import {
  listRestChannelAccountIds,
  resolveRestChannelAccount,
} from "./accounts.js";
import type { CoreConfig } from "./types.js";

afterEach(() => {
  delete process.env.REST_CHANNEL_OUTBOUND_API_KEY;
  delete process.env.REST_CHANNEL_OUTBOUND_BEARER_TOKEN;
  delete process.env.REST_CHANNEL_INBOUND_API_KEY;
  delete process.env.REST_CHANNEL_INBOUND_BEARER_TOKEN;
});

describe("resolveRestChannelAccount: safe defaults", () => {
  it("returns sensible defaults when no config is set", () => {
    const account = resolveRestChannelAccount({ cfg: {}, accountId: "default" });

    expect(account.accountId).toBe("default");
    expect(account.enabled).toBe(true);
    expect(account.outboundUrl).toBe("");
    expect(account.outboundAuthMethod).toBe("none");
    expect(account.outboundApiKey).toBe("");
    expect(account.outboundApiKeyHeader).toBe("X-Api-Key");
    expect(account.outboundBearerToken).toBe("");
    expect(account.inboundAuthMethod).toBe("none");
    expect(account.inboundApiKey).toBe("");
    expect(account.inboundApiKeyHeader).toBe("X-Api-Key");
    expect(account.inboundBearerToken).toBe("");
  });
});

describe("resolveRestChannelAccount: config values", () => {
  it("resolves outboundUrl from config", () => {
    const cfg: CoreConfig = {
      channels: { "rest-channel": { outboundUrl: "https://example.com/reply" } },
    };
    expect(resolveRestChannelAccount({ cfg, accountId: "default" }).outboundUrl).toBe(
      "https://example.com/reply",
    );
  });

  it("resolves outbound api-key auth from config", () => {
    const cfg: CoreConfig = {
      channels: {
        "rest-channel": {
          outboundAuthMethod: "api-key",
          outboundApiKey: "my-key",
        },
      },
    };
    const account = resolveRestChannelAccount({ cfg, accountId: "default" });
    expect(account.outboundAuthMethod).toBe("api-key");
    expect(account.outboundApiKey).toBe("my-key");
  });

  it("resolves outbound bearer token from config", () => {
    const cfg: CoreConfig = {
      channels: {
        "rest-channel": {
          outboundAuthMethod: "bearer",
          outboundBearerToken: "tok",
        },
      },
    };
    const account = resolveRestChannelAccount({ cfg, accountId: "default" });
    expect(account.outboundAuthMethod).toBe("bearer");
    expect(account.outboundBearerToken).toBe("tok");
  });

  it("resolves custom inbound API key header", () => {
    const cfg: CoreConfig = {
      channels: {
        "rest-channel": {
          inboundAuthMethod: "api-key",
          inboundApiKey: "inbound-key",
          inboundApiKeyHeader: "X-Custom-Key",
        },
      },
    };
    const account = resolveRestChannelAccount({ cfg, accountId: "default" });
    expect(account.inboundAuthMethod).toBe("api-key");
    expect(account.inboundApiKey).toBe("inbound-key");
    expect(account.inboundApiKeyHeader).toBe("X-Custom-Key");
  });

  it("resolves account name from config", () => {
    const cfg: CoreConfig = {
      channels: { "rest-channel": { name: "My REST Channel" } },
    };
    expect(resolveRestChannelAccount({ cfg, accountId: "default" }).name).toBe(
      "My REST Channel",
    );
  });

  it("treats enabled: false as disabled", () => {
    const cfg: CoreConfig = {
      channels: { "rest-channel": { enabled: false } },
    };
    expect(resolveRestChannelAccount({ cfg, accountId: "default" }).enabled).toBe(false);
  });
});

describe("resolveRestChannelAccount: environment variables", () => {
  it("reads outbound API key from env for the default account", () => {
    process.env.REST_CHANNEL_OUTBOUND_API_KEY = "env-outbound-key";
    const account = resolveRestChannelAccount({ cfg: {}, accountId: "default" });
    expect(account.outboundApiKey).toBe("env-outbound-key");
  });

  it("reads outbound bearer token from env for the default account", () => {
    process.env.REST_CHANNEL_OUTBOUND_BEARER_TOKEN = "env-bearer";
    const account = resolveRestChannelAccount({ cfg: {}, accountId: "default" });
    expect(account.outboundBearerToken).toBe("env-bearer");
  });

  it("reads inbound API key from env for the default account", () => {
    process.env.REST_CHANNEL_INBOUND_API_KEY = "env-inbound-key";
    const account = resolveRestChannelAccount({ cfg: {}, accountId: "default" });
    expect(account.inboundApiKey).toBe("env-inbound-key");
  });

  it("reads inbound bearer token from env for the default account", () => {
    process.env.REST_CHANNEL_INBOUND_BEARER_TOKEN = "env-inbound-bearer";
    const account = resolveRestChannelAccount({ cfg: {}, accountId: "default" });
    expect(account.inboundBearerToken).toBe("env-inbound-bearer");
  });
});

describe("resolveRestChannelAccount: named accounts", () => {
  it("resolves a named account and merges base config fields", () => {
    const cfg: CoreConfig = {
      channels: {
        "rest-channel": {
          outboundAuthMethod: "api-key",
          outboundApiKey: "base-key",
          accounts: {
            secondary: {
              outboundUrl: "https://secondary.example.com/reply",
            },
          },
        },
      },
    };

    const account = resolveRestChannelAccount({ cfg, accountId: "secondary" });
    expect(account.accountId).toBe("secondary");
    expect(account.outboundUrl).toBe("https://secondary.example.com/reply");
    // base-level key merges into named account
    expect(account.outboundApiKey).toBe("base-key");
  });

  it("allows a named account to override the base outboundApiKey", () => {
    const cfg: CoreConfig = {
      channels: {
        "rest-channel": {
          outboundApiKey: "base-key",
          accounts: {
            secondary: {
              outboundApiKey: "secondary-key",
              outboundUrl: "https://secondary.example.com/reply",
            },
          },
        },
      },
    };

    const account = resolveRestChannelAccount({ cfg, accountId: "secondary" });
    expect(account.outboundApiKey).toBe("secondary-key");
  });
});

describe("listRestChannelAccountIds", () => {
  it("returns [default] when a base channel config is present", () => {
    const cfg: CoreConfig = {
      channels: { "rest-channel": { outboundUrl: "https://example.com" } },
    };
    expect(listRestChannelAccountIds(cfg)).toContain("default");
  });

  it("includes named accounts in the list", () => {
    const cfg: CoreConfig = {
      channels: {
        "rest-channel": {
          accounts: {
            secondary: { outboundUrl: "https://secondary.example.com" },
          },
        },
      },
    };
    const ids = listRestChannelAccountIds(cfg);
    expect(ids).toContain("secondary");
  });

  it("returns an empty array when no rest-channel config is present", () => {
    const ids = listRestChannelAccountIds({});
    expect(ids).toHaveLength(0);
  });
});
