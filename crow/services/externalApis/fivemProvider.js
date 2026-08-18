"use strict";

// FiveM servers expose a public, unauthenticated status endpoint per-server —
// no API key needed. What's actually needed is knowing which host:port to
// query per guild (see db/repositories via fivem_servers table / commands).
async function getStatus(host, port) {
    const base = `http://${host}:${port}`;

    const [dynamic, players] = await Promise.all([
        fetch(`${base}/dynamic.json`, { signal: AbortSignal.timeout(5000) })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        fetch(`${base}/players.json`, { signal: AbortSignal.timeout(5000) })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
    ]);

    if (!dynamic) return { online: false };

    return {
        online: true,
        hostname: dynamic.hostname,
        mapname: dynamic.mapname,
        gametype: dynamic.gametype,
        clients: dynamic.clients,
        maxClients: dynamic.sv_maxclients,
        players: Array.isArray(players) ? players.map((p) => p.name) : [],
    };
}

module.exports = { getStatus };
