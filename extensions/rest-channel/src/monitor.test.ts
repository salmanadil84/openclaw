import { describe, expect, it, vi } from "vitest";
import { WEBHOOK_RATE_LIMIT_DEFAULTS } from "../runtime-api.js";
import { startRestWebhookServer } from "./monitor.test-harness.js";

const WEBHOOK_PATH = "/rest-channel-webhook";

describe("rest-channel webhook server: API key auth", () => {
  it("accepts requests with the correct API key", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "api-key",
      inboundApiKey: "secret-key",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": "secret-key",
      },
      body: JSON.stringify({ from: "user123", text: "Hello" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(typeof json.messageId).toBe("string");
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it("rejects requests with an incorrect API key", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "api-key",
      inboundApiKey: "correct-key",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": "wrong-key",
      },
      body: JSON.stringify({ from: "user123", text: "Hello" }),
    });

    expect(response.status).toBe(401);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects requests with no API key header", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "api-key",
      inboundApiKey: "correct-key",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "user123", text: "Hello" }),
    });

    expect(response.status).toBe(401);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("uses a custom API key header when inboundApiKeyHeader is set", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "api-key",
      inboundApiKey: "my-key",
      inboundApiKeyHeader: "X-Custom-Auth",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Custom-Auth": "my-key",
      },
      body: JSON.stringify({ from: "user1", text: "Hi" }),
    });

    expect(response.status).toBe(200);
    expect(onMessage).toHaveBeenCalledOnce();
  });
});

describe("rest-channel webhook server: Bearer token auth", () => {
  it("accepts requests with the correct Bearer token", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "bearer",
      inboundBearerToken: "my-bearer-token",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer my-bearer-token",
      },
      body: JSON.stringify({ from: "sender", text: "Hello!" }),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it("rejects requests with an incorrect Bearer token", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "bearer",
      inboundBearerToken: "correct-token",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ from: "sender", text: "Hello" }),
    });

    expect(response.status).toBe(401);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects requests with no Authorization header", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "bearer",
      inboundBearerToken: "correct-token",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "sender", text: "Hello" }),
    });

    expect(response.status).toBe(401);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe("rest-channel webhook server: no auth", () => {
  it("accepts requests without credentials when authMethod is none", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "anon", text: "Hi" }),
    });

    expect(response.status).toBe(200);
    expect(onMessage).toHaveBeenCalledOnce();
  });
});

describe("rest-channel webhook server: payload parsing", () => {
  it("rejects malformed JSON", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json {{{",
    });

    expect(response.status).toBe(400);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects payloads missing the 'from' field", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });

    expect(response.status).toBe(400);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("rejects payloads missing the 'text' field", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage,
    });

    const response = await fetch(harness.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "user123" }),
    });

    expect(response.status).toBe(400);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("passes optional threadId and to fields through to the message", async () => {
    const onMessage = vi.fn(async () => {});
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage,
    });

    await fetch(harness.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "user1",
        text: "Reply",
        to: "agent",
        threadId: "thread-42",
      }),
    });

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "user1",
        text: "Reply",
        to: "agent",
        threadId: "thread-42",
      }),
    );
  });

  it("assigns a unique messageId to each inbound message", async () => {
    const messages: string[] = [];
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage: async (msg) => {
        messages.push(msg.messageId);
      },
    });

    for (let i = 0; i < 3; i += 1) {
      await fetch(harness.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "user1", text: `msg ${i}` }),
      });
    }

    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(3);
  });
});

describe("rest-channel webhook server: routing", () => {
  it("returns 404 for unknown paths", async () => {
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage: vi.fn(async () => {}),
    });

    const response = await fetch(
      harness.webhookUrl.replace(WEBHOOK_PATH, "/not-the-webhook"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );

    expect(response.status).toBe(404);
  });

  it("returns 200 text/plain 'ok' for /healthz", async () => {
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "none",
      onMessage: vi.fn(async () => {}),
    });

    const healthUrl = harness.webhookUrl.replace(WEBHOOK_PATH, "/healthz");
    const response = await fetch(healthUrl);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });
});

describe("rest-channel webhook server: auth rate limiting", () => {
  it("rate limits repeated auth failures from the same IP", async () => {
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "api-key",
      inboundApiKey: "correct-key",
      onMessage: vi.fn(async () => {}),
    });

    let firstResponse: Response | undefined;
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt <= WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests; attempt += 1) {
      const response = await fetch(harness.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": "wrong-key",
        },
        body: JSON.stringify({ from: "attacker", text: "Hi" }),
      });
      if (attempt === 0) firstResponse = response;
      lastResponse = response;
    }

    expect(firstResponse?.status).toBe(401);
    expect(lastResponse?.status).toBe(429);
    expect(await lastResponse?.text()).toBe("Too Many Requests");
  });

  it("does not rate limit successful auth bursts from the same IP", async () => {
    const harness = await startRestWebhookServer({
      path: WEBHOOK_PATH,
      inboundAuthMethod: "api-key",
      inboundApiKey: "correct-key",
      onMessage: vi.fn(async () => {}),
    });

    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt <= WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests; attempt += 1) {
      lastResponse = await fetch(harness.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": "correct-key",
        },
        body: JSON.stringify({ from: "user123", text: "Hello" }),
      });
    }

    expect(lastResponse?.status).toBe(200);
  });
});
