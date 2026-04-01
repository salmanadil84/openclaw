import type { DmPolicy } from "openclaw/plugin-sdk/rest-channel";

/** Supported auth methods for inbound and outbound REST requests. */
export type RestChannelAuthMethod = "api-key" | "bearer" | "none";

/** Per-account config section written to openclaw.yaml. */
export type RestChannelAccountConfig = {
  /** HTTP endpoint to POST agent replies to. */
  outboundUrl?: string;
  /** Auth method used when sending outbound requests. Default: "none". */
  outboundAuthMethod?: RestChannelAuthMethod;
  /** API key sent in outbound requests (outboundAuthMethod = "api-key"). */
  outboundApiKey?: string;
  /** Header name for the outbound API key. Default: "X-Api-Key". */
  outboundApiKeyHeader?: string;
  /** Bearer token sent in outbound requests (outboundAuthMethod = "bearer"). */
  outboundBearerToken?: string;
  /** Auth method used when verifying inbound webhook requests. Default: "none". */
  inboundAuthMethod?: RestChannelAuthMethod;
  /** API key that inbound requests must present (inboundAuthMethod = "api-key"). */
  inboundApiKey?: string;
  /** Header name for the inbound API key. Default: "X-Api-Key". */
  inboundApiKeyHeader?: string;
  /** Bearer token that inbound requests must present (inboundAuthMethod = "bearer"). */
  inboundBearerToken?: string;
  /** TCP port for the inbound webhook server. Default: 8789. */
  webhookPort?: number;
  /** Host/IP to bind the inbound server to. Default: "0.0.0.0". */
  webhookHost?: string;
  /** URL path for the inbound webhook endpoint. Default: "/rest-channel-webhook". */
  webhookPath?: string;
  /** Public-facing URL shown in logs (optional). */
  webhookPublicUrl?: string;
  /** DM access policy. Default: "pairing". */
  dmPolicy?: DmPolicy;
  /** List of sender IDs allowed to message the agent directly. */
  allowFrom?: Array<string | number>;
  /** Account display name. */
  name?: string;
  /** Whether this account is enabled. Default: true. */
  enabled?: boolean;
  /** Allow outbound fetch to private/internal IP ranges. Default: false. */
  allowPrivateNetwork?: boolean;
};

/** Top-level REST channel config (shared base + optional named accounts). */
export type RestChannelConfig = RestChannelAccountConfig & {
  accounts?: Record<string, Partial<RestChannelAccountConfig>>;
  defaultAccount?: string;
};

/** OpenClaw config shape narrowed to include rest-channel section. */
export type CoreConfig = {
  channels?: {
    "rest-channel"?: RestChannelConfig;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Inbound message parsed from an external REST POST. */
export type RestChannelInboundMessage = {
  /** Sender identifier — used for access control and routing. */
  from: string;
  /** Message text body. */
  text: string;
  /** Optional target the sender is addressing (e.g. an agent alias). */
  to?: string;
  /** Optional thread identifier for continued conversations. */
  threadId?: string;
  /** Receive timestamp (epoch ms). */
  timestamp: number;
  /** Unique message ID assigned by the inbound handler. */
  messageId: string;
};

/** Body shape posted to the inbound webhook by external systems. */
export type RestChannelInboundBody = {
  from: string;
  text: string;
  to?: string;
  threadId?: string;
};

/** Body shape posted to the outbound URL by the agent. */
export type RestChannelOutboundBody = {
  from: string;
  to: string;
  text: string;
  channel: "rest-channel";
  timestamp: number;
  threadId?: string;
  replyToId?: string;
};

/** Result returned from a successful send. */
export type RestChannelSendResult = {
  messageId: string;
  to: string;
};

/** Options accepted by the webhook server factory. */
export type RestChannelWebhookServerOptions = {
  port: number;
  host: string;
  path: string;
  inboundAuthMethod: RestChannelAuthMethod;
  inboundApiKey?: string;
  inboundApiKeyHeader?: string;
  inboundBearerToken?: string;
  onMessage: (message: RestChannelInboundMessage) => Promise<void>;
  onError?: (error: Error) => void;
  abortSignal?: AbortSignal;
  maxBodyBytes?: number;
};
