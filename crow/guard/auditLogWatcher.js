"use strict";

// Per-guild in-flight-fetch dedupe + short result cache. A real raid can trigger
// dozens of role/channel/ban events within seconds — each naively fetching the
// audit log would blow through Discord's per-route rate limit exactly when it
// matters most. Callers awaiting a fetch already in flight get the same promise
// instead of issuing a new REST call.
const CACHE_TTL_MS = 2000;
const inFlight = new Map();
const cache = new Map();

function cacheKey(guildId, action) {
    return `${guildId}:${action}`;
}

async function fetchRecentEntries(guild, action) {
    const key = cacheKey(guild.id, action);

    const cached = cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.entries;
    }

    if (inFlight.has(key)) {
        return inFlight.get(key);
    }

    const promise = guild
        .fetchAuditLogs({ type: action, limit: 5 })
        .then((logs) => [...logs.entries.values()])
        .catch(() => [])
        .finally(() => inFlight.delete(key));

    inFlight.set(key, promise);
    const entries = await promise;
    cache.set(key, { entries, fetchedAt: Date.now() });
    return entries;
}

// Finds the audit log entry that most plausibly explains a change to `targetId`,
// within a short recency window (audit log entries can lag a few seconds behind
// the gateway event that reveals the change).
async function resolveExecutor(guild, action, targetId, { maxAgeMs = 10_000 } = {}) {
    const entries = await fetchRecentEntries(guild, action);
    const match = entries.find(
        (e) => (!targetId || e.targetId === targetId) && Date.now() - e.createdTimestamp < maxAgeMs
    );
    return match ? { executorId: match.executorId, reason: match.reason, entry: match } : null;
}

module.exports = { fetchRecentEntries, resolveExecutor };
