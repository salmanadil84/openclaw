import { afterEach, describe, expect, it, vi } from "vitest";

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

import { sendMessageRestChannel } from "./send.js";
import type { CoreConfig } from "./types.js";

const API_KEY_CONFIG: CoreConfig = {
  channels: {
    "rest-channel": {
      outboundUrl: "https://example.com/reply",
      outboundAuthMethod: "api-key",
      outboundApiKey: "my-api-key",
    },
  },
};

const BEARER_CONFIG: CoreConfig = {
  channels: {
    "rest-channel": {
      outboundUrl: "https://example.com/reply",
      outboundAuthMethod: "bearer",
      outboundBearerToken: "my-bearer-token",
    },
  },
};

function mockOkResponse(responseBody?: Record<string, unknown>) {
  const release = vi.fn(async () => {});
  fetchWithSsrFGuard.mockResolvedValue({
    response: {
      ok: true,
      status: 200,
      json: async () => responseBody ?? {},
      text: async () => JSON.stringify(responseBody ?? {}),
    },
    release,
  });
  return release;
}

function mockErrorResponse(status: number, body = "") {
  const release = vi.fn(async () => {});
  fetchWithSsrFGuard.mockResolvedValue({
    response: {
      ok: false,
      status,
      json: async () => { throw new Error("not json"); },
      text: async () => body,
    },
    release,
  });
  return release;
}

afterEach(() => {
  fetchWithSsrFGuard.mockReset();
});

describe("sendMessageRestChannel: API key auth", () => {
  it("sets X-Api-Key header for api-key auth method", async () => {
    const release = mockOkResponse();
    await sendMessageRestChannel("user123", "Hello!", { cfg: API_KEY_CONFIG });

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/reply",
        init: expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Api-Key": "my-api-key",
          }),
        }),
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("uses a custom API key header when outboundApiKeyHeader is set", async () => {
    mockOkResponse();
    const cfg: CoreConfig = {
      channels: {
        "rest-channel": {
          outboundUrl: "https://example.com/reply",
          outboundAuthMethod: "api-key",
          outboundApiKey: "key-value",
          outboundApiKeyHeader: "X-My-Custom-Key",
        },
      },
    };

    await sendMessageRestChannel("user1", "Hi", { cfg });

    const callArgs = fetchWithSsrFGuard.mock.calls[0][0];
    expect(callArgs.init.headers["X-My-Custom-Key"]).toBe("key-value");
  });
});

describe("sendMessageRestChannel: Bearer auth", () => {
  it("sets Authorization: Bearer header for bearer auth method", async () => {
    mockOkResponse();
    await sendMessageRestChannel("user1", "Hi", { cfg: BEARER_CONFIG });

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-bearer-token",
          }),
        }),
      }),
    );
  });
});

describe("sendMessageRestChannel: request body shape", () => {
  it("sends correct JSON envelope", async () => {
    mockOkResponse();
    await sendMessageRestChannel("user123", "Hello world!", { cfg: API_KEY_CONFIG });

    const callArgs = fetchWithSsrFGuard.mock.calls[0][0];
    const body = JSON.parse(callArgs.init.body as string);

    expect(body).toMatchObject({
      from: "openclaw",
      to: "user123",
      text: "Hello world!",
      channel: "rest-channel",
    });
    expect(typeof body.timestamp).toBe("number");
  });

  it("strips rest-channel prefix from the recipient", async () => {
    mockOkResponse();
    await sendMessageRestChannel("rest-channel:user456", "Hi", { cfg: API_KEY_CONFIG });

    const body = JSON.parse(fetchWithSsrFGuard.mock.calls[0][0].init.body as string);
    expect(body.to).toBe("user456");
  });

  it("includes threadId in the body when provided", async () => {
    mockOkResponse();
    await sendMessageRestChannel("user1", "Hello", {
      cfg: API_KEY_CONFIG,
      threadId: "thread-99",
    });

    const body = JSON.parse(fetchWithSsrFGuard.mock.calls[0][0].init.body as string);
    expect(body.threadId).toBe("thread-99");
  });

  it("omits threadId from the body when not provided", async () => {
    mockOkResponse();
    await sendMessageRestChannel("user1", "Hello", { cfg: API_KEY_CONFIG });

    const body = JSON.parse(fetchWithSsrFGuard.mock.calls[0][0].init.body as string);
    expect("threadId" in body).toBe(false);
  });

  it("includes replyToId in the body when provided", async () => {
    mockOkResponse();
    await sendMessageRestChannel("user1", "Hello", {
      cfg: API_KEY_CONFIG,
      replyToId: "msg-original",
    });

    const body = JSON.parse(fetchWithSsrFGuard.mock.calls[0][0].init.body as string);
    expect(body.replyToId).toBe("msg-original");
  });
});

describe("sendMessageRestChannel: response handling", () => {
  it("returns messageId from response JSON", async () => {
    mockOkResponse({ messageId: "server-msg-123" });
    const result = await sendMessageRestChannel("user1", "Hello", { cfg: API_KEY_CONFIG });
    expect(result.messageId).toBe("server-msg-123");
    expect(result.to).toBe("user1");
  });

  it("falls back to id field if messageId is absent", async () => {
    mockOkResponse({ id: "42" });
    const result = await sendMessageRestChannel("user1", "Hello", { cfg: API_KEY_CONFIG });
    expect(result.messageId).toBe("42");
  });

  it("generates a fallback messageId when response body has no id", async () => {
    mockOkResponse({});
    const result = await sendMessageRestChannel("user1", "Hello", { cfg: API_KEY_CONFIG });
    expect(result.messageId).toMatch(/^rest-\d+$/);
  });

  it("releases the fetch guard even when response parsing fails", async () => {
    const release = vi.fn(async () => {});
    fetchWithSsrFGuard.mockResolvedValue({
      response: {
        ok: true,
        status: 200,
        json: async () => { throw new Error("parse failure"); },
        text: async () => "not json",
      },
      release,
    });

    await sendMessageRestChannel("user1", "Hi", { cfg: API_KEY_CONFIG });
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("sendMessageRestChannel: error handling", () => {
  it("throws a descriptive error on 401 Unauthorized", async () => {
    mockErrorResponse(401);
    await expect(
      sendMessageRestChannel("user1", "Hello", { cfg: API_KEY_CONFIG }),
    ).rejects.toThrow("authentication failed");
  });

  it("throws a descriptive error on 403 Forbidden", async () => {
    mockErrorResponse(403);
    await expect(
      sendMessageRestChannel("user1", "Hello", { cfg: API_KEY_CONFIG }),
    ).rejects.toThrow("forbidden");
  });

  it("throws a descriptive error on 404 Not Found", async () => {
    mockErrorResponse(404);
    await expect(
      sendMessageRestChannel("user1", "Hello", { cfg: API_KEY_CONFIG }),
    ).rejects.toThrow("not found");
  });

  it("throws when outboundUrl is not configured", async () => {
    const cfg: CoreConfig = { channels: { "rest-channel": {} } };
    await expect(sendMessageRestChannel("user1", "Hello", { cfg })).rejects.toThrow(
      "outboundUrl not configured",
    );
  });

  it("throws when recipient is empty", async () => {
    await expect(
      sendMessageRestChannel("", "Hello", { cfg: API_KEY_CONFIG }),
    ).rejects.toThrow("recipient");
  });
});

describe("sendMessageRestChannel: audit context", () => {
  it("passes the rest-channel-send audit context to fetchWithSsrFGuard", async () => {
    mockOkResponse();
    await sendMessageRestChannel("user1", "Hi", { cfg: API_KEY_CONFIG });

    expect(fetchWithSsrFGuard).toHaveBeenCalledWith(
      expect.objectContaining({ auditContext: "rest-channel-send" }),
    );
  });
});
