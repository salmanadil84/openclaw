import {
  buildAccountScopedDmSecurityPolicy,
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  buildRuntimeAccountStatusSnapshot,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatAllowFromLowercase,
  mapAllowFromEntries,
  normalizeAccountId,
  runPassiveAccountLifecycle,
  setAccountEnabledInConfigSection,
  applyAccountNameToChannelSection,
  patchScopedAccountConfig,
  type ChannelPlugin,
  type ChannelSetupInput,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/rest-channel";
import {
  listRestChannelAccountIds,
  resolveDefaultRestChannelAccountId,
  resolveRestChannelAccount,
  type ResolvedRestChannelAccount,
} from "./accounts.js";
import { RestChannelConfigSchema } from "./config-schema.js";
import { monitorRestChannelProvider } from "./monitor.js";
import {
  looksLikeRestChannelTargetId,
  normalizeRestChannelMessagingTarget,
} from "./normalize.js";
import { getRestChannelRuntime } from "./runtime.js";
import { sendMessageRestChannel } from "./send.js";
import type { CoreConfig } from "./types.js";

const CHANNEL_SECTION = "rest-channel" as const;
const CHANNEL_PREFIX_RE = /^(rest-channel|rest|http-channel):/i;

const meta = {
  id: CHANNEL_SECTION,
  label: "REST Channel",
  selectionLabel: "REST Channel (custom HTTP)",
  docsPath: "/channels/rest-channel",
  docsLabel: "rest-channel",
  blurb: "Bidirectional messaging over any HTTP/REST API.",
  aliases: ["rest", "http-channel"],
  order: 90,
  quickstartAllowFrom: true,
} as const;

type RestChannelSetupInput = ChannelSetupInput & {
  outboundUrl?: string;
  outboundAuthMethod?: string;
  outboundApiKey?: string;
  outboundBearerToken?: string;
  inboundAuthMethod?: string;
  inboundApiKey?: string;
  inboundBearerToken?: string;
};

function validateRestChannelUrl(value: string | undefined): string | undefined {
  if (!value) {
    return "Required";
  }
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return "URL must start with http:// or https://";
  }
  return undefined;
}

export const restChannelPlugin: ChannelPlugin<ResolvedRestChannelAccount> = {
  id: CHANNEL_SECTION,
  meta,
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  reload: {
    configPrefixes: [`channels.${CHANNEL_SECTION}`],
  },

  configSchema: buildChannelConfigSchema(RestChannelConfigSchema),

  config: {
    listAccountIds: (cfg) => listRestChannelAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) =>
      resolveRestChannelAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultRestChannelAccountId(cfg as CoreConfig),
    isConfigured: (account) => account.enabled && Boolean(account.outboundUrl || account.inboundAuthMethod !== "none"),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        channelKey: CHANNEL_SECTION,
        accountId,
        enabled,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({ cfg, channelKey: CHANNEL_SECTION, accountId }),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      url: account.outboundUrl || undefined,
      enabled: account.enabled,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      mapAllowFromEntries(
        resolveRestChannelAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom,
      ),
    formatAllowFrom: ({ allowFrom }) =>
      formatAllowFromLowercase({ allowFrom, stripPrefixRe: CHANNEL_PREFIX_RE }),
  },

  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId ?? DEFAULT_ACCOUNT_ID),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({ cfg, channelKey: CHANNEL_SECTION, accountId, name }),
    validateInput: ({ input }) => {
      const setupInput = input as RestChannelSetupInput;
      if (setupInput.outboundUrl) {
        const urlError = validateRestChannelUrl(setupInput.outboundUrl);
        if (urlError) {
          return urlError;
        }
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const setupInput = input as RestChannelSetupInput;
      const named = applyAccountNameToChannelSection({
        cfg,
        channelKey: CHANNEL_SECTION,
        accountId,
        name: setupInput.name,
      });
      const patch: Record<string, unknown> = {};
      if (setupInput.outboundUrl) {
        patch.outboundUrl = setupInput.outboundUrl.trim();
      }
      if (setupInput.outboundAuthMethod) {
        patch.outboundAuthMethod = setupInput.outboundAuthMethod;
      }
      if (setupInput.outboundApiKey) {
        patch.outboundApiKey = setupInput.outboundApiKey;
      }
      if (setupInput.outboundBearerToken) {
        patch.outboundBearerToken = setupInput.outboundBearerToken;
      }
      if (setupInput.inboundAuthMethod) {
        patch.inboundAuthMethod = setupInput.inboundAuthMethod;
      }
      if (setupInput.inboundApiKey) {
        patch.inboundApiKey = setupInput.inboundApiKey;
      }
      if (setupInput.inboundBearerToken) {
        patch.inboundBearerToken = setupInput.inboundBearerToken;
      }
      return patchScopedAccountConfig({
        cfg: named,
        channelKey: CHANNEL_SECTION,
        accountId,
        patch,
      });
    },
  },

  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) =>
      buildAccountScopedDmSecurityPolicy({
        cfg,
        channelKey: CHANNEL_SECTION,
        accountId,
        fallbackAccountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
        policy: account.config.dmPolicy,
        allowFrom: account.config.allowFrom ?? [],
        policyPathSuffix: "dmPolicy",
        normalizeEntry: (raw) =>
          raw
            .trim()
            .replace(CHANNEL_PREFIX_RE, "")
            .trim()
            .toLowerCase(),
      }),
  },

  messaging: {
    normalizeTarget: normalizeRestChannelMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeRestChannelTargetId,
      hint: "<senderId>",
    },
  },

  outbound: {
    deliveryMode: "direct",
    sendText: async ({ cfg, to, text, accountId }) => {
      const result = await sendMessageRestChannel(to, text, {
        accountId: accountId ?? undefined,
        cfg: cfg as CoreConfig,
      });
      return { channel: CHANNEL_SECTION, messageId: result.messageId };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => buildBaseChannelStatusSummary(snapshot),
    buildAccountSnapshot: ({ runtime }) => buildRuntimeAccountStatusSnapshot({ runtime }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;

      ctx.log?.info(`[${account.accountId}] starting REST channel webhook server`);

      await runPassiveAccountLifecycle({
        abortSignal: ctx.abortSignal,
        start: async () => {
          const { stop } = await monitorRestChannelProvider({
            accountId: account.accountId,
            config: ctx.cfg as CoreConfig,
            runtime: ctx.runtime,
            abortSignal: ctx.abortSignal,
          });
          return stop;
        },
        stop: (stopFn) => {
          stopFn();
        },
        onStop: () => {
          ctx.log?.info(`[${account.accountId}] REST channel webhook server stopped`);
        },
      });
    },
  },

  pairing: {
    idLabel: "senderId",
    normalizeAllowEntry: (entry) =>
      entry
        .trim()
        .replace(CHANNEL_PREFIX_RE, "")
        .trim()
        .toLowerCase(),
  },
};
