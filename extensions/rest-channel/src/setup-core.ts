import type { ChannelSetupAdapter, ChannelSetupInput } from "openclaw/plugin-sdk/channel-setup";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/routing";
import {
  applyAccountNameToChannelSection,
  createSetupInputPresenceValidator,
  createTopLevelChannelDmPolicy,
  mergeAllowFromEntries,
  patchScopedAccountConfig,
  promptParsedAllowFromForAccount,
  resolveSetupAccountId,
  type ChannelSetupDmPolicy,
  type WizardPrompter,
} from "openclaw/plugin-sdk/setup-runtime";
import { formatDocsLink } from "openclaw/plugin-sdk/setup-tools";
import {
  listRestChannelAccountIds,
  resolveDefaultRestChannelAccountId,
  resolveRestChannelAccount,
} from "./accounts.js";
import type { CoreConfig } from "./types.js";

const channel = "rest-channel" as const;

type RestChannelSetupInput = ChannelSetupInput & {
  outboundUrl?: string;
  outboundAuthMethod?: string;
  outboundApiKey?: string;
  outboundBearerToken?: string;
  inboundAuthMethod?: string;
  inboundApiKey?: string;
  inboundBearerToken?: string;
};

export function setRestChannelAccountConfig(
  cfg: CoreConfig,
  accountId: string,
  updates: Record<string, unknown>,
): CoreConfig {
  return patchScopedAccountConfig({
    cfg,
    channelKey: channel,
    accountId,
    patch: updates,
  }) as CoreConfig;
}

export function validateRestChannelUrl(value: string | undefined): string | undefined {
  if (!value) {
    return "Required";
  }
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return "URL must start with http:// or https://";
  }
  return undefined;
}

async function promptRestChannelAllowFrom(params: {
  cfg: CoreConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<CoreConfig> {
  return await promptParsedAllowFromForAccount({
    cfg: params.cfg,
    accountId: params.accountId,
    defaultAccountId: params.accountId,
    prompter: params.prompter,
    noteTitle: "REST channel sender ID",
    noteLines: [
      'This is the "from" field value sent by the external system.',
      "Example: user123, sensor-device-1, my-crm",
      `Docs: ${formatDocsLink("/channels/rest-channel", "rest-channel")}`,
    ],
    message: "Allowed sender IDs (allowFrom)",
    placeholder: "user123",
    parseEntries: (raw) => ({
      entries: String(raw)
        .split(/[\n,;]+/g)
        .map((v) => v.trim())
        .filter(Boolean),
    }),
    getExistingAllowFrom: ({ cfg, accountId }) =>
      resolveRestChannelAccount({ cfg, accountId }).config.allowFrom?.map(String) ?? [],
    mergeEntries: ({ existing, parsed }) => mergeAllowFromEntries(existing, parsed),
    applyAllowFrom: ({ cfg, accountId, allowFrom }) =>
      setRestChannelAccountConfig(cfg as CoreConfig, accountId, {
        dmPolicy: "allowlist",
        allowFrom,
      }),
  });
}

async function promptAllowFromForAccount(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<OpenClawConfig> {
  const accountId = resolveSetupAccountId({
    accountId: params.accountId,
    defaultAccountId: resolveDefaultRestChannelAccountId(params.cfg as CoreConfig),
  });
  return await promptRestChannelAllowFrom({
    cfg: params.cfg as CoreConfig,
    prompter: params.prompter,
    accountId,
  });
}

export const restChannelDmPolicy: ChannelSetupDmPolicy = createTopLevelChannelDmPolicy({
  label: "REST Channel",
  channel,
  policyKey: "channels.rest-channel.dmPolicy",
  allowFromKey: "channels.rest-channel.allowFrom",
  getCurrent: (cfg) =>
    (cfg.channels as Record<string, { dmPolicy?: string } | undefined>)?.[channel]?.dmPolicy ??
    "pairing",
  promptAllowFrom: promptAllowFromForAccount,
});

export const restChannelSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  applyAccountName: ({ cfg, accountId, name }) =>
    applyAccountNameToChannelSection({ cfg, channelKey: channel, accountId, name }),
  validateInput: createSetupInputPresenceValidator({
    validate: ({ input }) => {
      const setupInput = input as RestChannelSetupInput;
      if (setupInput.outboundUrl && validateRestChannelUrl(setupInput.outboundUrl)) {
        return validateRestChannelUrl(setupInput.outboundUrl) ?? null;
      }
      return null;
    },
  }),
  applyAccountConfig: ({ cfg, accountId, input }) => {
    const setupInput = input as RestChannelSetupInput;
    const named = applyAccountNameToChannelSection({
      cfg,
      channelKey: channel,
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
    return setRestChannelAccountConfig(named as CoreConfig, accountId, patch);
  },
};
