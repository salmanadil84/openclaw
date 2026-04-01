const CHANNEL_PREFIX_RE = /^(rest-channel|rest|http-channel):/i;

/** Strip the channel prefix from a target string (e.g. "rest-channel:user123" → "user123"). */
export function stripRestChannelTargetPrefix(raw: string): string {
  return raw.trim().replace(CHANNEL_PREFIX_RE, "").trim();
}

/** Normalize a target for storage/comparison. */
export function normalizeRestChannelMessagingTarget(raw: string): string {
  return stripRestChannelTargetPrefix(raw);
}

/** Returns true if the string looks like a REST channel target ID (plain or prefixed). */
export function looksLikeRestChannelTargetId(raw: string): boolean {
  if (!raw?.trim()) {
    return false;
  }
  const stripped = stripRestChannelTargetPrefix(raw);
  return stripped.length > 0;
}
