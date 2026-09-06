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

/** &status — diagnostics techniques du bot, réservé au rang sys (mêmes infos sensibles que &sources). */
async function status(client, message) {
  if (!accessStore.isAllowed("sys", message.author.id)) return;

  const nodes = listNodes(client);
  const lavalinkLines = nodes.length
    ? nodes.map((n) => `> \`${n.name}\` : ${n.state === ShoukakuState.CONNECTED ? "🟢 connecté" : `🔴 état ${n.state}`}`)
    : ["> *aucun nœud déclaré*"];

  const mem = process.memoryUsage();
  const toMB = (bytes) => `${Math.round(bytes / 1024 / 1024)} Mo`;

  await message.reply({
    embeds: [
      buildStatusEmbed("info", null, {
        title: "Diagnostics du bot",
        fields: [
          { name: "Uptime", value: formatUptime(client.uptime), inline: true },
          { name: "Latence gateway", value: `${client.ws.ping}ms`, inline: true },
          { name: "Mémoire (RSS)", value: toMB(mem.rss), inline: true },
          { name: "Serveurs", value: String(client.guilds.cache.size), inline: true },
          { name: "Node.js", value: process.version, inline: true },
          { name: "discord.js", value: `v${DISCORDJS_VERSION}`, inline: true },
          { name: "Lavalink", value: lavalinkLines.join("\n") },
        ],
      }),
    ],
  });
}

module.exports = { status };
