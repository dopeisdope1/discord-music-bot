const MENTION_RE = /^<@!?(\d+)>$/;
const ROLE_MENTION_RE = /^<@&(\d+)>$/;
const CHANNEL_MENTION_RE = /^<#(\d+)>$/;
const ID_RE = /^\d{15,25}$/;

function extractUserId(raw) {
  if (!raw) return null;
  const m = raw.match(MENTION_RE);
  if (m) return m[1];
  if (ID_RE.test(raw)) return raw;
  return null;
}

function extractRoleId(raw) {
  if (!raw) return null;
  const m = raw.match(ROLE_MENTION_RE);
  if (m) return m[1];
  if (ID_RE.test(raw)) return raw;
  return null;
}

function extractChannelId(raw) {
  if (!raw) return null;
  const m = raw.match(CHANNEL_MENTION_RE);
  if (m) return m[1];
  if (ID_RE.test(raw)) return raw;
  return null;
}

module.exports = { extractUserId, extractRoleId, extractChannelId };
