import {
  DEFAULT_ACCOUNT_ID,
  createAccountListHelpers,
  normalizeAccountId,
  normalizeResolvedSecretInputString,
  resolveAccountWithDefaultFallback,
} from "openclaw/plugin-sdk/rest-channel";
import type { CoreConfig, RestChannelAccountConfig, RestChannelAuthMethod } from "./types.js";

export type ResolvedRestChannelAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  outboundUrl: string;
  outboundAuthMethod: RestChannelAuthMethod;
  outboundApiKey: string;
  outboundApiKeyHeader: string;
  outboundBearerToken: string;
  inboundAuthMethod: RestChannelAuthMethod;
  inboundApiKey: string;
  inboundApiKeyHeader: string;
  inboundBearerToken: string;
  config: RestChannelAccountConfig;
};

const {
  listAccountIds: listRestChannelAccountIdsInternal,
  resolveDefaultAccountId: resolveDefaultRestChannelAccountId,
} = createAccountListHelpers("rest-channel", { normalizeAccountId });

export { resolveDefaultRestChannelAccountId };

export function listRestChannelAccountIds(cfg: CoreConfig): string[] {
  return listRestChannelAccountIdsInternal(cfg);
}

function resolveAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): Partial<RestChannelAccountConfig> | undefined {
  const accounts = cfg.channels?.["rest-channel"]?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  const direct = accounts[accountId] as Partial<RestChannelAccountConfig> | undefined;
  if (direct) {
    return direct;
  }
  const normalized = normalizeAccountId(accountId);
  const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === normalized);
  return matchKey
    ? (accounts[matchKey] as Partial<RestChannelAccountConfig> | undefined)
    : undefined;
}

function mergeRestChannelAccountConfig(
  cfg: CoreConfig,
  accountId: string,
): RestChannelAccountConfig {
  const {
    accounts: _accounts,
    defaultAccount: _defaultAccount,
    ...base
  } = (cfg.channels?.["rest-channel"] ?? {}) as RestChannelAccountConfig & {
    accounts?: unknown;
    defaultAccount?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

function resolveSecret(
  merged: RestChannelAccountConfig,
  configKey: keyof RestChannelAccountConfig,
  envKey: string,
  accountId: string,
  configPath: string,
): string {
  const envValue = process.env[envKey]?.trim();
  if (envValue && (!accountId || accountId === DEFAULT_ACCOUNT_ID)) {
    return envValue;
  }
  return (
    normalizeResolvedSecretInputString({
      value: merged[configKey] as string | undefined,
      path: configPath,
    }) ?? ""
  );
}

export function resolveRestChannelAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedRestChannelAccount {
  const baseEnabled = params.cfg.channels?.["rest-channel"]?.enabled !== false;

  const resolve = (accountId: string): ResolvedRestChannelAccount => {
    const merged = mergeRestChannelAccountConfig(params.cfg, accountId);
    const accountEnabled = merged.enabled !== false;
    const enabled = baseEnabled && accountEnabled;

    const outboundApiKey = resolveSecret(
      merged,
      "outboundApiKey",
      "REST_CHANNEL_OUTBOUND_API_KEY",
      accountId,
      `channels.rest-channel.accounts.${accountId}.outboundApiKey`,
    );
    const outboundBearerToken = resolveSecret(
      merged,
      "outboundBearerToken",
      "REST_CHANNEL_OUTBOUND_BEARER_TOKEN",
      accountId,
      `channels.rest-channel.accounts.${accountId}.outboundBearerToken`,
    );
    const inboundApiKey = resolveSecret(
      merged,
      "inboundApiKey",
      "REST_CHANNEL_INBOUND_API_KEY",
      accountId,
      `channels.rest-channel.accounts.${accountId}.inboundApiKey`,
    );
    const inboundBearerToken = resolveSecret(
      merged,
      "inboundBearerToken",
      "REST_CHANNEL_INBOUND_BEARER_TOKEN",
      accountId,
      `channels.rest-channel.accounts.${accountId}.inboundBearerToken`,
    );

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      outboundUrl: merged.outboundUrl?.trim() ?? "",
      outboundAuthMethod: merged.outboundAuthMethod ?? "none",
      outboundApiKey,
      outboundApiKeyHeader: merged.outboundApiKeyHeader?.trim() || "X-Api-Key",
      outboundBearerToken,
      inboundAuthMethod: merged.inboundAuthMethod ?? "none",
      inboundApiKey,
      inboundApiKeyHeader: merged.inboundApiKeyHeader?.trim() || "X-Api-Key",
      inboundBearerToken,
      config: merged,
    };
  };

  return resolveAccountWithDefaultFallback({
    accountId: params.accountId,
    normalizeAccountId,
    resolvePrimary: resolve,
    hasCredential: (account) =>
      Boolean(account.outboundUrl) ||
      Boolean(account.inboundApiKey) ||
      Boolean(account.inboundBearerToken),
    resolveDefaultAccountId: () => resolveDefaultRestChannelAccountId(params.cfg),
  });
}

export function listEnabledRestChannelAccounts(cfg: CoreConfig): ResolvedRestChannelAccount[] {
  return listRestChannelAccountIds(cfg)
    .map((accountId) => resolveRestChannelAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
