import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { hasConfiguredSecretInput } from "openclaw/plugin-sdk/secret-input";
import {
  createStandardChannelSetupStatus,
  formatDocsLink,
  setSetupChannelEnabled,
  type ChannelSetupWizard,
} from "openclaw/plugin-sdk/setup";
import { listRestChannelAccountIds, resolveRestChannelAccount } from "./accounts.js";
import {
  restChannelDmPolicy,
  restChannelSetupAdapter,
  setRestChannelAccountConfig,
  validateRestChannelUrl,
} from "./setup-core.js";
import type { CoreConfig } from "./types.js";

const channel = "rest-channel" as const;

export const restChannelSetupWizard: ChannelSetupWizard = {
  channel,
  stepOrder: "text-first",
  status: createStandardChannelSetupStatus({
    channelLabel: "REST Channel",
    configuredLabel: "configured",
    unconfiguredLabel: "needs setup",
    configuredHint: "custom HTTP",
    unconfiguredHint: "custom REST API",
    configuredScore: 1,
    unconfiguredScore: 5,
    resolveConfigured: ({ cfg }) =>
      listRestChannelAccountIds(cfg as CoreConfig).some((accountId) => {
        const account = resolveRestChannelAccount({ cfg: cfg as CoreConfig, accountId });
        return Boolean(account.outboundUrl);
      }),
  }),
  introNote: {
    title: "REST Channel setup",
    lines: [
      "OpenClaw will POST agent replies to your outboundUrl as JSON:",
      '  { "from": "openclaw", "to": "<senderId>", "text": "...", "channel": "rest-channel", "timestamp": ... }',
      "",
      "External systems send messages to OpenClaw by POSTing to the webhook:",
      '  { "from": "<senderId>", "text": "Hello!" }',
      "",
      `Docs: ${formatDocsLink("/channels/rest-channel", "rest-channel")}`,
    ],
    shouldShow: ({ cfg, accountId }) => {
      const account = resolveRestChannelAccount({ cfg: cfg as CoreConfig, accountId });
      return !account.outboundUrl;
    },
  },
  credentials: [
    {
      inputKey: "token",
      providerHint: "rest-channel-outbound",
      credentialLabel: "outbound API key",
      preferredEnvVar: "REST_CHANNEL_OUTBOUND_API_KEY",
      envPrompt: "REST_CHANNEL_OUTBOUND_API_KEY detected. Use env var?",
      keepPrompt: "Outbound API key already configured. Keep it?",
      inputPrompt: "Enter API key for outbound requests (or leave blank to skip)",
      optional: true,
      inspect: ({ cfg, accountId }) => {
        const account = resolveRestChannelAccount({ cfg: cfg as CoreConfig, accountId });
        return {
          accountConfigured: Boolean(account.outboundApiKey),
          hasConfiguredValue: hasConfiguredSecretInput(account.config.outboundApiKey),
          resolvedValue: account.outboundApiKey || undefined,
          envValue:
            process.env.REST_CHANNEL_OUTBOUND_API_KEY?.trim() || undefined,
        };
      },
      applySet: async (params) =>
        setRestChannelAccountConfig(params.cfg as CoreConfig, params.accountId, {
          outboundApiKey: params.value,
          outboundAuthMethod: "api-key",
        }),
    },
    {
      inputKey: "botToken",
      providerHint: "rest-channel-inbound",
      credentialLabel: "inbound API key",
      preferredEnvVar: "REST_CHANNEL_INBOUND_API_KEY",
      envPrompt: "REST_CHANNEL_INBOUND_API_KEY detected. Use env var?",
      keepPrompt: "Inbound API key already configured. Keep it?",
      inputPrompt: "Enter API key for verifying inbound webhook requests (or leave blank to skip)",
      optional: true,
      inspect: ({ cfg, accountId }) => {
        const account = resolveRestChannelAccount({ cfg: cfg as CoreConfig, accountId });
        return {
          accountConfigured: Boolean(account.inboundApiKey),
          hasConfiguredValue: hasConfiguredSecretInput(account.config.inboundApiKey),
          resolvedValue: account.inboundApiKey || undefined,
          envValue:
            process.env.REST_CHANNEL_INBOUND_API_KEY?.trim() || undefined,
        };
      },
      applySet: async (params) =>
        setRestChannelAccountConfig(params.cfg as CoreConfig, params.accountId, {
          inboundApiKey: params.value,
          inboundAuthMethod: "api-key",
        }),
    },
  ],
  textInputs: [
    {
      inputKey: "httpUrl",
      message: "Enter the outbound URL (e.g., https://myapp.example.com/openclaw/reply)",
      currentValue: ({ cfg, accountId }) =>
        resolveRestChannelAccount({ cfg: cfg as CoreConfig, accountId }).outboundUrl || undefined,
      shouldPrompt: ({ currentValue }) => !currentValue,
      validate: ({ value }) => validateRestChannelUrl(value),
      normalizeValue: ({ value }) => value.trim().replace(/\/$/, ""),
      applySet: async (params) =>
        setRestChannelAccountConfig(params.cfg as CoreConfig, params.accountId, {
          outboundUrl: params.value,
        }),
    },
  ],
  dmPolicy: restChannelDmPolicy,
  disable: (cfg: OpenClawConfig) => setSetupChannelEnabled(cfg, channel, false),
};

export { restChannelSetupAdapter };
