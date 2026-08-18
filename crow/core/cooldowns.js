"use strict";

// Process-local, in-memory cooldown tracker keyed by any string the caller builds
// (e.g. `${identityKey}:${guildId}:${userId}:${commandName}`). Fine for a
// single-process bot; not shared across restarts, which is the correct behavior
// for a cooldown.
const lastUse = new Map();

function isOnCooldown(key, ms) {
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
