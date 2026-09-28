const http = require("http");

function startApiServer(
  client,
  { port, apiKey, botName, commands, commandsStore, commandRules, getPrefix, setPrefix, messageStore, logStore, statsStore, statsMetrics, systems }
) {
  if (!apiKey) {
    console.warn(`[panel-api] PANEL_API_KEY non defini - API desactivee.`);
    return;
  }
  commands = commands || [];

  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === null ? "" : JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (url.pathname === "/healthz") return send(res, 200, { status: "ok" });
    if (token !== apiKey) return send(res, 401, { error: "unauthorized" });

    if (url.pathname === "/capabilities" && req.method === "GET") {
      const caps = ["status", "guilds"];
      if (getPrefix) caps.push("guildConfig");
      if (commands.length && commandsStore) caps.push("commands");
      if (commandRules) caps.push("commandRules", "roles", "channels");
      if (messageStore) caps.push("messages");
      if (logStore) caps.push("logs");
      if (statsStore) caps.push("statistics");
    if (systems) caps.push("systems");
      return send(res, 200, { capabilities: caps });
    }

    if (url.pathname === "/status" && req.method === "GET") {
      const ready = client.isReady();
      return send(res, 200, {
        state: ready ? "online" : "connecting",
        latencyMs: ready ? Math.round(client.ws.ping) : null,
        uptimeSeconds: Math.round(process.uptime()),
        guildCount: ready ? client.guilds.cache.size : null,
        lastCheckedAt: new Date().toISOString(),
      });
    }

    if (url.pathname === "/guilds" && req.method === "GET") {
      if (!client.isReady()) return send(res, 200, []);
      const guilds = client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        iconUrl: g.iconURL({ size: 128 }) || null,
        memberCount: g.memberCount ?? null,
        ownerDiscordId: g.ownerId ?? null,
        addedAt: g.joinedAt ? g.joinedAt.toISOString() : null,
      }));
      return send(res, 200, guilds);
    }

    const rolesMatch = url.pathname.match(/^\/guilds\/([^/]+)\/roles$/);
    if (rolesMatch && req.method === "GET") {
      const guild = client.guilds.cache.get(decodeURIComponent(rolesMatch[1]));
      if (!guild) return send(res, 404, { error: "guild_not_found" });
      const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
      const list = [...roles.values()]
        .filter((r) => r.id !== guild.id) // @everyone exclu — jamais une cible utile pour "rôle autorisé/interdit"
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position, managed: r.managed, memberCount: r.members.size }));
      return send(res, 200, list);
    }

    const channelsMatch = url.pathname.match(/^\/guilds\/([^/]+)\/channels$/);
    if (channelsMatch && req.method === "GET") {
      const guild = client.guilds.cache.get(decodeURIComponent(channelsMatch[1]));
      if (!guild) return send(res, 404, { error: "guild_not_found" });
      const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
      const list = [...channels.values()]
        .filter((c) => c && c.isTextBased?.())
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId || null }));
      return send(res, 200, list);
    }

    const configMatch = url.pathname.match(/^\/guilds\/([^/]+)\/config$/);
    if (configMatch && getPrefix) {
      const guildId = decodeURIComponent(configMatch[1]);
      if (req.method === "GET") {
        return send(res, 200, { guildId, prefix: getPrefix(guildId), updatedAt: null });
      }
      if (req.method === "PATCH") {
        const body = await readBody(req);
        if (typeof body.prefix === "string" && body.prefix.length > 0 && setPrefix) {
          setPrefix(guildId, body.prefix);
        }
        return send(res, 200, { guildId, prefix: getPrefix(guildId), updatedAt: new Date().toISOString() });
      }
    }

    if (url.pathname === "/commands" && req.method === "GET" && commandsStore) {
      const guildId = url.searchParams.get("guildId") || undefined;
      const list = commands.map((c) => ({
        id: c.name,
        name: c.name,
        category: c.category || null,
        description: c.description || null,
        permissions: null,
        enabledGlobally: commandsStore.isEnabledGlobally(c.name),
        ...(guildId ? { enabledForGuild: commandsStore.isEnabledForGuild(c.name, guildId) } : {}),
      }));
      return send(res, 200, list);
    }

    const cmdMatch = url.pathname.match(/^\/commands\/([^/]+)$/);
    if (cmdMatch && req.method === "PATCH" && commandsStore) {
      const name = decodeURIComponent(cmdMatch[1]);
      const body = await readBody(req);
      if (body.guildId) commandsStore.setGuildEnabled(body.guildId, name, !!body.enabled);
      else commandsStore.setGlobalEnabled(name, !!body.enabled);
      return send(res, 204, null);
    }

    // Vue groupée pour la page "Rôles" du panel : la règle de CHAQUE commande
    // en un seul appel (au lieu d'une requête par commande) — toujours
    // utils/commandRules.js::getRule, jamais un état recalculé autrement.
    if (url.pathname === "/commands/rules" && req.method === "GET" && commandRules) {
      const guildId = url.searchParams.get("guildId");
      if (!guildId) return send(res, 400, { error: "guildId_required" });
      const byCommand = {};
      for (const c of commands) byCommand[c.name] = commandRules.getRule(guildId, c.name);
      return send(res, 200, byCommand);
    }

    // "Permissions & règles" — proxy fin vers utils/commandRules.js, le
    // MÊME store que le panel Discord existant (&panel/!!config/=panel >
    // "Gestion des commandes") : jamais un deuxième système, jamais une
    // deuxième base. Chaque action ici appelle exactement la fonction que le
    // panel Discord appelle déjà pour le même effet.
    const rulesMatch = url.pathname.match(/^\/commands\/([^/]+)\/rules$/);
    if (rulesMatch && commandRules) {
      const name = decodeURIComponent(rulesMatch[1]);
      const guildId = url.searchParams.get("guildId");
      if (!guildId) return send(res, 400, { error: "guildId_required" });

      if (req.method === "GET") {
        return send(res, 200, commandRules.getRule(guildId, name));
      }

      if (req.method === "PATCH") {
        const body = await readBody(req);
        const TOGGLE_ACTIONS = {
          toggleAllowedRole: commandRules.toggleAllowedRole,
          toggleDeniedRole: commandRules.toggleDeniedRole,
          toggleAllowedUser: commandRules.toggleAllowedUser,
          toggleDeniedUser: commandRules.toggleDeniedUser,
          toggleAllowedChannel: commandRules.toggleAllowedChannel,
          toggleDeniedChannel: commandRules.toggleDeniedChannel,
        };
        const toggleFn = body.action && TOGGLE_ACTIONS[body.action];
        if (toggleFn && typeof body.id === "string" && body.id) {
          toggleFn(guildId, name, body.id);
        } else if (body.action === "setCooldown") {
          commandRules.setCooldown(guildId, name, typeof body.seconds === "number" ? body.seconds : null);
        } else if (body.action === "reset") {
          commandRules.resetRule(guildId, name);
        } else {
          return send(res, 400, { error: "unknown_action" });
        }
        return send(res, 200, commandRules.getRule(guildId, name));
      }
    }

    if (url.pathname === "/messages" && req.method === "GET" && messageStore) {
      return send(res, 200, [
        { key: messageStore.key, label: messageStore.label || messageStore.key, description: messageStore.description || "", fields: messageStore.fields || null },
      ]);
    }

    const msgMatch = url.pathname.match(/^\/messages\/([^/]+)$/);
    if (msgMatch && messageStore && decodeURIComponent(msgMatch[1]) === messageStore.key) {
      const guildId = url.searchParams.get("guildId") || undefined;
      if (!guildId) return send(res, 400, { error: "guildId required" });
      if (req.method === "GET") return send(res, 200, messageStore.get(guildId));
      if (req.method === "PATCH") {
        const body = await readBody(req);
        return send(res, 200, messageStore.set(guildId, body));
      }
    }

    if (url.pathname === "/logs" && req.method === "GET" && logStore) {
      const filters = {
        guildId: url.searchParams.get("guildId") || undefined,
        type: url.searchParams.get("type") || undefined,
        level: url.searchParams.get("level") || undefined,
        search: url.searchParams.get("search") || undefined,
        from: url.searchParams.get("from") || undefined,
        to: url.searchParams.get("to") || undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      };
      return send(res, 200, logStore.query(filters));
    }

    if (url.pathname === "/statistics/metrics" && req.method === "GET" && statsStore) {
      return send(res, 200, statsMetrics || []);
    }

    if (url.pathname === "/statistics" && req.method === "GET" && statsStore) {
      const metric = url.searchParams.get("metric");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
      const toDate = to ? new Date(to) : new Date();
      const days = Math.max(1, Math.min(90, Math.ceil((toDate - fromDate) / 86400000) + 1));
      const fromKey = fromDate.toISOString().slice(0, 10);
      const toKey = toDate.toISOString().slice(0, 10);
      const guildIds = client.isReady() ? [...client.guilds.cache.keys()] : [];
      const totals = new Map();
      for (const gid of guildIds) {
        const range = statsStore.getRange(gid, days);
        for (const point of range) {
          if (point.date < fromKey || point.date > toKey) continue;
          const v = point[metric];
          if (typeof v !== "number") continue;
          totals.set(point.date, (totals.get(point.date) || 0) + v);
        }
      }
      const result = [...totals.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, value]) => ({ metric, value, capturedAt: `${date}T00:00:00.000Z` }));
      return send(res, 200, result);
    }

  const systemsListMatch = url.pathname.match(/^\/systems\/([^/]+)$/);
  if (systemsListMatch && req.method === "GET" && systems) {
    const guildId = decodeURIComponent(systemsListMatch[1]);
    const list = systems.map((s) => {
      const state = s.getState(guildId) || {};
      return {
        key: s.key,
        label: s.label,
        description: s.description,
        icon: s.icon || "settings",
        category: s.category || null,
        enabled: !!state.enabled,
        config: state.config || {},
        updatedAt: state.updatedAt || null,
      };
    });
    return send(res, 200, list);
  }

  const systemMatch = url.pathname.match(/^\/systems\/([^/]+)\/([^/]+)$/);
  if (systemMatch && req.method === "PATCH" && systems) {
    const guildId = decodeURIComponent(systemMatch[1]);
    const key = decodeURIComponent(systemMatch[2]);
    const def = systems.find((s) => s.key === key);
    if (!def) return send(res, 404, { error: "unknown_system" });
    const body = await readBody(req);
    const state = def.setState(guildId, body || {}) || {};
    return send(res, 200, {
      key: def.key,
      label: def.label,
      description: def.description,
      icon: def.icon || "settings",
      category: def.category || null,
      enabled: !!state.enabled,
      config: state.config || {},
      updatedAt: state.updatedAt || null,
    });
  }

    return send(res, 404, { error: "not_found" });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[panel-api] ${botName} ecoute sur le port ${port}.`);
  });

  return server;
}

module.exports = startApiServer;
