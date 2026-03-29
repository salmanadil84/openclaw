import { type AddressInfo } from "node:net";
import { afterEach } from "vitest";
import { createRestChannelWebhookServer } from "./monitor.js";
import type { RestChannelWebhookServerOptions } from "./types.js";

export type WebhookHarness = {
  webhookUrl: string;
  stop: () => Promise<void>;
};

const cleanupFns: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupFns.length > 0) {
    const cleanup = cleanupFns.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

export type StartRestWebhookServerParams = Omit<RestChannelWebhookServerOptions, "port" | "host"> & {
  host?: string;
  port?: number;
};

export async function startRestWebhookServer(
  params: StartRestWebhookServerParams,
): Promise<WebhookHarness> {
  const host = params.host ?? "127.0.0.1";
  const port = params.port ?? 0;
  const { server, start } = createRestChannelWebhookServer({
    ...params,
    port,
    host,
  });
  await start();
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("missing server address");
  }

  const harness: WebhookHarness = {
    webhookUrl: `http://${host}:${address.port}${params.path}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
  cleanupFns.push(harness.stop);
  return harness;
}
