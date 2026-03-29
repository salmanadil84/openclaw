import { describeWebhookAccountSnapshot } from "openclaw/plugin-sdk/account-helpers";
import { formatAllowFromLowercase } from "openclaw/plugin-sdk/allow-from";
import {
  adaptScopedAccountAccessor,
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { createLoggedPairingApprovalNotifier, createPairingPrefixStripper } from "openclaw/plugin-sdk/channel-pairing";
import { createAllowlistProviderRouteAllowlistWarningCollector } from "openclaw/plugin-sdk/channel-policy";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/core";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import {
  buildWebhookChannelStatusSummary,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import {
  buildChannelConfigSchema,
  clearAccountEntryFields,
  DEFAULT_ACCOUNT_ID,
  type ChannelPlugin,
  type OpenClawConfig,
} from "../runtime-api.js";
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
import { resolveRestChannelOutboundSessionRoute } from "./session-route.js";
import { restChannelSetupAdapter } from "./setup-core.js";
import { restChannelSetupWizard } from "./setup-surface.js";
import type { CoreConfig } from "./types.js";

const CHANNEL_SECTION = "rest-channel" as const;

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

const restChannelConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedRestChannelAccount,
  ResolvedRestChannelAccount,
  CoreConfig
>({
  sectionKey: CHANNEL_SECTION,
  listAccountIds: listRestChannelAccountIds,
  resolveAccount: adaptScopedAccountAccessor(resolveRestChannelAccount),
  defaultAccountId: resolveDefaultRestChannelAccountId,
  clearBaseFields: ["outboundApiKey", "outboundBearerToken", "inboundApiKey", "inboundBearerToken"],
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) =>
    formatAllowFromLowercase({
      allowFrom,
      stripPrefixRe: /^(rest-channel|rest|http-channel):/i,
    }),
});

const resolveRestChannelDmPolicy = createScopedDmSecurityResolver<ResolvedRestChannelAccount>({
  channelKey: CHANNEL_SECTION,
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  policyPathSuffix: "dmPolicy",
  normalizeEntry: (raw) =>
    raw
      .trim()
      .replace(/^(rest-channel|rest|http-channel):/i, "")
      .trim(),
});

const collectRestChannelSecurityWarnings =
  createAllowlistProviderRouteAllowlistWarningCollector<ResolvedRestChannelAccount>({
    providerConfigPresent: (cfg) =>
      (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_SECTION] !== undefined,
    resolveGroupPolicy: () => "allowlist" as const,
    resolveRouteAllowlistConfigured: () => false, // REST is direct-only; no route allowlists
    restrictSenders: {
      surface: "REST channel",
      openScope: "any sender ID not explicitly denied",
      groupPolicyPath: `channels.${CHANNEL_SECTION}.groupPolicy`,
      groupAllowFromPath: `channels.${CHANNEL_SECTION}.allowFrom`,
    },
    noRouteAllowlist: {
      surface: "REST channel senders",
      routeAllowlistPath: `channels.${CHANNEL_SECTION}.allowFrom`,
      routeScope: "sender",
      groupPolicyPath: `channels.${CHANNEL_SECTION}.dmPolicy`,
      groupAllowFromPath: `channels.${CHANNEL_SECTION}.allowFrom`,
    },
  });

export const restChannelPlugin: ChannelPlugin<ResolvedRestChannelAccount> = createChatChannelPlugin(
  {
    base: {
      id: CHANNEL_SECTION,
      meta,
      setupWizard: restChannelSetupWizard,
      capabilities: {
        chatTypes: ["direct"],
        reactions: false,
        threads: false,
        media: false,
        nativeCommands: false,
        blockStreaming: true,
      },
      reload: { configPrefixes: [`channels.${CHANNEL_SECTION}`] },
      configSchema: buildChannelConfigSchema(RestChannelConfigSchema),
      config: {
        ...restChannelConfigAdapter,
        isConfigured: (account) => Boolean(account.outboundUrl?.trim()),
        describeAccount: (account) =>
          describeWebhookAccountSnapshot({
            account,
            configured: Boolean(account.outboundUrl?.trim()),
            extra: {
              outboundUrl: account.outboundUrl ? "[set]" : "[missing]",
              outboundAuthMethod: account.outboundAuthMethod,
              inboundAuthMethod: account.inboundAuthMethod,
            },
          }),
      },
      messaging: {
        normalizeTarget: normalizeRestChannelMessagingTarget,
        resolveOutboundSessionRoute: (params) => resolveRestChannelOutboundSessionRoute(params),
        targetResolver: {
          looksLikeId: looksLikeRestChannelTargetId,
          hint: "<senderId>",
        },
      },
      setup: restChannelSetupAdapter,
      status: createComputedAccountStatusAdapter<ResolvedRestChannelAccount>({
        defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
        buildChannelSummary: ({ snapshot }) =>
          buildWebhookChannelStatusSummary(snapshot, {
            secretSource:
              (snapshot as Record<string, unknown>).outboundAuthMethod ?? "none",
          }),
        resolveAccountSnapshot: ({ account }) => ({
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled,
          configured: Boolean(account.outboundUrl?.trim()),
          extra: {
            outboundUrl: account.outboundUrl ? "[set]" : "[missing]",
            outboundAuthMethod: account.outboundAuthMethod,
            inboundAuthMethod: account.inboundAuthMethod,
          },
        }),
      }),
      gateway: {
        startAccount: async (ctx) => {
          const account = ctx.account;
          ctx.log?.info(`[${account.accountId}] starting REST channel webhook server`);

          const statusSink = createAccountStatusSink({
            accountId: ctx.accountId,
            setStatus: ctx.setStatus,
          });

          await runStoppablePassiveMonitor({
            abortSignal: ctx.abortSignal,
            start: async () =>
              await monitorRestChannelProvider({
                accountId: account.accountId,
                config: ctx.cfg as CoreConfig,
                runtime: ctx.runtime,
                abortSignal: ctx.abortSignal,
                statusSink,
              }),
          });
        },
        logoutAccount: async ({ accountId, cfg }) => {
          const nextCfg = { ...cfg } as OpenClawConfig;
          const nextSection = cfg.channels?.[CHANNEL_SECTION]
            ? { ...cfg.channels[CHANNEL_SECTION] }
            : undefined;
          let cleared = false;
          let changed = false;

          if (nextSection) {
            const secretFields = [
              "outboundApiKey",
              "outboundBearerToken",
              "inboundApiKey",
              "inboundBearerToken",
            ] as const;
            for (const field of secretFields) {
              if (accountId === DEFAULT_ACCOUNT_ID && (nextSection as Record<string, unknown>)[field]) {
                delete (nextSection as Record<string, unknown>)[field];
                cleared = true;
                changed = true;
              }
            }
            const accountCleanup = clearAccountEntryFields({
              accounts: (nextSection as Record<string, unknown>).accounts as
                | Record<string, unknown>
                | undefined,
              accountId,
              fields: ["outboundApiKey", "outboundBearerToken", "inboundApiKey", "inboundBearerToken"],
            });
            if (accountCleanup.changed) {
              changed = true;
              if (accountCleanup.cleared) {
                cleared = true;
              }
              const sectionAsRecord = nextSection as Record<string, unknown>;
              if (accountCleanup.nextAccounts) {
                sectionAsRecord.accounts = accountCleanup.nextAccounts;
              } else {
                delete sectionAsRecord.accounts;
              }
            }
          }

          if (changed) {
            if (nextSection && Object.keys(nextSection).length > 0) {
              nextCfg.channels = {
                ...nextCfg.channels,
                [CHANNEL_SECTION]: nextSection,
              } as OpenClawConfig["channels"];
            } else {
              const nextChannels = { ...nextCfg.channels } as Record<string, unknown>;
              delete nextChannels[CHANNEL_SECTION];
              if (Object.keys(nextChannels).length > 0) {
                nextCfg.channels = nextChannels as OpenClawConfig["channels"];
              } else {
                delete nextCfg.channels;
              }
            }
          }

          const resolved = resolveRestChannelAccount({
            cfg: changed ? (nextCfg as CoreConfig) : (cfg as CoreConfig),
            accountId,
          });
          const loggedOut =
            !resolved.outboundApiKey &&
            !resolved.outboundBearerToken &&
            !resolved.inboundApiKey &&
            !resolved.inboundBearerToken;

          if (changed) {
            await getRestChannelRuntime().config.writeConfigFile(nextCfg);
          }

          return {
            cleared,
            loggedOut,
          };
        },
      },
    },
    pairing: {
      text: {
        idLabel: "restChannelSenderId",
        message: "OpenClaw: your access has been approved.",
        normalizeAllowEntry: createPairingPrefixStripper(
          /^(rest-channel|rest|http-channel):/i,
          (entry) => entry.trim(),
        ),
        notify: createLoggedPairingApprovalNotifier(
          ({ id }) => `[rest-channel] Sender ${id} approved for pairing`,
        ),
      },
    },
    security: {
      resolveDmPolicy: resolveRestChannelDmPolicy,
      collectWarnings: collectRestChannelSecurityWarnings,
    },
    outbound: {
      base: {
        deliveryMode: "direct",
        chunker: (text, limit) =>
          getRestChannelRuntime().channel.text.chunkMarkdownText(text, limit),
        chunkerMode: "markdown",
        textChunkLimit: 4000,
      },
      attachedResults: {
        channel: CHANNEL_SECTION,
        sendText: async ({ cfg, to, text, accountId, replyToId, threadId }) =>
          await sendMessageRestChannel(to, text, {
            accountId: accountId ?? undefined,
            cfg: cfg as CoreConfig,
            replyToId: replyToId ?? undefined,
            threadId: threadId ?? undefined,
          }),
      },
    },
  },
);
