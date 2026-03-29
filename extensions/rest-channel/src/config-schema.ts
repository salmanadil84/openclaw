import {
  DmPolicySchema,
  MarkdownConfigSchema,
  ReplyRuntimeConfigSchemaShape,
  buildSecretInputSchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/rest-channel";
import { requireChannelOpenAllowFrom } from "openclaw/plugin-sdk/extension-shared";
import { z } from "openclaw/plugin-sdk/zod";

const RestChannelAuthMethodSchema = z.enum(["api-key", "bearer", "none"]).optional();

export const RestChannelAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    markdown: MarkdownConfigSchema,
    outboundUrl: z.string().url().optional(),
    outboundAuthMethod: RestChannelAuthMethodSchema,
    outboundApiKey: buildSecretInputSchema().optional(),
    outboundApiKeyHeader: z.string().optional(),
    outboundBearerToken: buildSecretInputSchema().optional(),
    inboundAuthMethod: RestChannelAuthMethodSchema,
    inboundApiKey: buildSecretInputSchema().optional(),
    inboundApiKeyHeader: z.string().optional(),
    inboundBearerToken: buildSecretInputSchema().optional(),
    webhookPort: z.number().int().positive().optional(),
    webhookHost: z.string().optional(),
    webhookPath: z.string().optional(),
    webhookPublicUrl: z.string().optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(z.string()).optional(),
    allowPrivateNetwork: z.boolean().optional(),
    ...ReplyRuntimeConfigSchemaShape,
  })
  .strict();

export const RestChannelAccountSchema = RestChannelAccountSchemaBase.superRefine((value, ctx) => {
  requireChannelOpenAllowFrom({
    channel: "rest-channel",
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    requireOpenAllowFrom,
  });
});

export const RestChannelConfigSchema = RestChannelAccountSchemaBase.extend({
  accounts: z.record(z.string(), RestChannelAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  requireChannelOpenAllowFrom({
    channel: "rest-channel",
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    requireOpenAllowFrom,
  });
});
