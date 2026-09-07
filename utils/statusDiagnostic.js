const { version: DISCORDJS_VERSION } = require("discord.js");
const { Constants: ShoukakuConstants } = require("shoukaku");
const { buildStatusEmbed } = require("./statusEmbed");
const accessStore = require("./accessStore");

const ShoukakuState = ShoukakuConstants.State;

/** Même robustesse que index.js::listNodes — Map, tableau ou objet selon la version de Shoukaku. */
function listNodes(client) {
  const raw = client.kazagumo?.shoukaku?.nodes;
  if (!raw) return [];
  if (typeof raw.values === "function") return [...raw.values()];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

/**
 * Cœur de &status, sans le message Discord : réutilisé tel quel par le
 * dashboard du panel (rubrique Accueil) pour éviter une deuxième lecture des
 * mêmes compteurs client/process.
 */
function computeStatus(client) {
  const nodes = listNodes(client);
  const mem = process.memoryUsage();
  return {
    uptimeMs: client.uptime,
    ping: client.ws.ping,
    memoryRssMB: Math.round(mem.rss / 1024 / 1024),
    guildCount: client.guilds.cache.size,
    nodeVersion: process.version,
    discordjsVersion: DISCORDJS_VERSION,
    lavalinkNodes: nodes.map((n) => ({ name: n.name, connected: n.state === ShoukakuState.CONNECTED, state: n.state })),
  };
}

/** &status — diagnostics techniques du bot, réservé au rang sys (mêmes infos sensibles que &sources). */
async function status(client, message) {
  if (!accessStore.isAllowed("sys", message.author.id)) return;

  const info = computeStatus(client);
  const lavalinkLines = info.lavalinkNodes.length
    ? info.lavalinkNodes.map((n) => `> \`${n.name}\` : ${n.connected ? "🟢 connecté" : `🔴 état ${n.state}`}`)
    : ["> *aucun nœud déclaré*"];

  await message.reply({
    embeds: [
      buildStatusEmbed("info", null, {
        title: "Diagnostics du bot",
        fields: [
          { name: "Uptime", value: formatUptime(info.uptimeMs), inline: true },
          { name: "Latence gateway", value: `${info.ping}ms`, inline: true },
          { name: "Mémoire (RSS)", value: `${info.memoryRssMB} Mo`, inline: true },
          { name: "Serveurs", value: String(info.guildCount), inline: true },
          { name: "Node.js", value: info.nodeVersion, inline: true },
          { name: "discord.js", value: `v${info.discordjsVersion}`, inline: true },
          { name: "Lavalink", value: lavalinkLines.join("\n") },
        ],
      }),
    ],
  });
}

module.exports = { status, computeStatus, formatUptime };
