import {
  createScopedPairingAccess,
  dispatchInboundReplyWithBase,
  formatTextWithAttachmentLinks,
  issuePairingChallenge,
  logInboundDrop,
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithCommandGate,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveOutboundMediaUrls,
  warnMissingProviderGroupPolicyFallbackOnce,
  type OutboundReplyPayload,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk/rest-channel";
import type { ResolvedRestChannelAccount } from "./accounts.js";
import { getRestChannelRuntime } from "./runtime.js";
import { sendMessageRestChannel } from "./send.js";
import type { CoreConfig, RestChannelInboundMessage } from "./types.js";

const CHANNEL_ID = "rest-channel" as const;

async function deliverRestChannelReply(params: {
  payload: OutboundReplyPayload;
  to: string;
  accountId: string;
  replyToId?: string | null;
  threadId?: string | null;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { payload, to, accountId, statusSink } = params;
  const combined = formatTextWithAttachmentLinks(payload.text, resolveOutboundMediaUrls(payload));
  if (!combined) {
    return;
  }
  await sendMessageRestChannel(to, combined, {
    accountId,
    replyToId: params.replyToId ?? undefined,
    threadId: params.threadId ?? undefined,
  });
  statusSink?.({ lastOutboundAt: Date.now() });
}

export async function handleRestChannelInbound(params: {
  message: RestChannelInboundMessage;
  account: ResolvedRestChannelAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getRestChannelRuntime();
  const pairing = createScopedPairingAccess({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const rawBody = message.text?.trim() ?? "";
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const senderId = message.from;
  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config as OpenClawConfig);
  const { providerMissingFallbackApplied } = resolveAllowlistProviderRuntimeGroupPolicy({
    providerConfigPresent:
      ((config.channels as Record<string, unknown> | undefined)?.["rest-channel"] ??
        undefined) !== undefined,
    groupPolicy: undefined, // REST channel is direct-only
    defaultGroupPolicy,
  });
  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: "rest-channel",
    accountId: account.accountId,
    blockedLabel: "direct messages",
    log: (msg) => runtime.log?.(msg),
  });

  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));
  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });
  const storeAllowList = (storeAllowFrom ?? []).map((v) => String(v));

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const useAccessGroups =
    (config.commands as Record<string, unknown> | undefined)?.useAccessGroups !== false;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config as OpenClawConfig);

  const access = resolveDmGroupAccessWithCommandGate({
    isGroup: false, // REST channel only supports direct messages
    dmPolicy,
    groupPolicy: "allowlist",
    allowFrom: configAllowFrom,
    groupAllowFrom: [],
    storeAllowFrom: storeAllowList,
    isSenderAllowed: (allowFrom) => allowFrom.includes(senderId),
    command: {
      useAccessGroups,
      allowTextCommands,
      hasControlCommand,
    },
  });

  const commandAuthorized = access.commandAuthorized;

  if (access.decision !== "allow") {
    if (access.decision === "pairing") {
      await issuePairingChallenge({
        channel: CHANNEL_ID,
        senderId,
        senderIdLine: `Your REST channel sender ID: ${senderId}`,
        meta: undefined,
        upsertPairingRequest: pairing.upsertPairingRequest,
        sendPairingReply: async (text) => {
          if (account.outboundUrl) {
            await sendMessageRestChannel(senderId, text, { accountId: account.accountId });
          }
          statusSink?.({ lastOutboundAt: Date.now() });
        },
        onReplyError: (err) => {
          runtime.error?.(
            `rest-channel: pairing reply failed for ${senderId}: ${String(err)}`,
          );
        },
      });
    }
    runtime.log?.(`rest-channel: drop sender ${senderId} (reason=${access.decision})`);
    return;
  }

  if (access.shouldBlockControlCommand) {
    logInboundDrop({
      log: (msg) => runtime.log?.(msg),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderId,
    });
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: "direct",
      id: senderId,
    },
  });

  const storePath = core.channel.session.resolveStorePath(
    (config.session as Record<string, unknown> | undefined)?.store as string | undefined,
    { agentId: route.agentId },
  );
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(
    config as OpenClawConfig,
  );
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "REST Channel",
    from: senderId,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `rest-channel:${senderId}`,
    To: message.to ? `rest-channel:${message.to}` : `rest-channel:${senderId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: senderId,
    SenderName: senderId,
    SenderId: senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `rest-channel:${senderId}`,
    CommandAuthorized: commandAuthorized,
    ...(message.threadId ? { ThreadId: message.threadId } : {}),
  });

  await dispatchInboundReplyWithBase({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      await deliverRestChannelReply({
        payload,
        to: senderId,
        accountId: account.accountId,
        statusSink,
      });
    },
    onRecordError: (err) => {
      runtime.error?.(`rest-channel: failed updating session meta: ${String(err)}`);
    },
    onDispatchError: (err, info) => {
      runtime.error?.(`rest-channel ${info.kind} reply failed: ${String(err)}`);
    },
  });
}
