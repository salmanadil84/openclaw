import {
  buildChannelOutboundSessionRoute,
  type ChannelOutboundSessionRouteParams,
} from "openclaw/plugin-sdk/core";
import { stripRestChannelTargetPrefix } from "./normalize.js";

export function resolveRestChannelOutboundSessionRoute(
  params: ChannelOutboundSessionRouteParams,
) {
  const senderId = stripRestChannelTargetPrefix(params.target);
  if (!senderId) {
    return null;
  }
  return buildChannelOutboundSessionRoute({
    cfg: params.cfg,
    agentId: params.agentId,
    channel: "rest-channel",
    accountId: params.accountId,
    peer: {
      kind: "direct",
      id: senderId,
    },
    chatType: "direct",
    from: `rest-channel:${senderId}`,
    to: `user:${senderId}`,
  });
}
