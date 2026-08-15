// Suivi des cooldowns en mémoire (process-local). Clé : `${guildId}:${userId}:${commandName}`.
const lastUse = new Map();

function isOnCooldown(key, ms) {
  if (!ms || ms <= 0) return false;
  const now = Date.now();
  const last = lastUse.get(key);
  if (last && now - last < ms) return true;
  lastUse.set(key, now);
  return false;
}

function remainingMs(key, ms) {
  const last = lastUse.get(key);
  if (!last) return 0;
  return Math.max(0, ms - (Date.now() - last));
}

module.exports = { isOnCooldown, remainingMs };
