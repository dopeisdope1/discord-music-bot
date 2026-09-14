/**
 * Limiteur de fréquence simple, en mémoire, à fenêtre glissante.
 * @param {number} maxUses
 * @param {number} windowMs
 */
function createRateLimiter(maxUses, windowMs) {
  const usage = new Map();

  return {
    /**
     * @param {string} key
     * @returns {{ allowed: boolean, retryAfterMs?: number }}
     */
    check(key) {
      const now = Date.now();
      const timestamps = (usage.get(key) || []).filter((t) => now - t < windowMs);

      if (timestamps.length >= maxUses) {
        return { allowed: false, retryAfterMs: windowMs - (now - timestamps[0]) };
      }

      timestamps.push(now);
      usage.set(key, timestamps);
      return { allowed: true };
    },
  };
}

module.exports = { createRateLimiter };
