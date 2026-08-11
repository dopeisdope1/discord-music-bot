const { handleLogsCommand } = require("./logsPanel");
const { buildHelpPanel } = require("./helpPanels");
const { getPrefixes } = require("./prefixStore");
const { waitForHydration } = require("./configChannel");

function buildLogsHelpPanel(prefix) {
  return buildHelpPanel({
    title: "Aide — Bot Logs",
    intro: `Préfixe : \`${prefix}\``,
    sections: [
      {
        heading: "Logs",
        lines: [
          `\`${prefix}logs\` — Choisit le salon de destination par catégorie (modération, salon, rôles, sécurité, blacklist)`,
        ],
      },
    ],
    footer: "Réservé aux owners anti-nuke de ce serveur (voir `=owner` sur le bot Antifast).",
  });
}

const handlers = {
  help: (client, message, args, prefix) => message.channel.send(buildLogsHelpPanel(prefix)),
  logs: (client, message) => handleLogsCommand(message),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Logs. Le préfixe est
 * configurable par serveur via `.panel` (bot Musique+Modération) — voir
 * utils/prefixStore.js/prefixPanel.js.
 */
async function handleLogsTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  // Si le bot vient de redémarrer, attend que le préfixe ait fini d'être
  // restauré depuis Discord avant de le lire (voir utils/configChannel.js).
  await waitForHydration(message.guild.id);

  const content = message.content.trim();
  const { logs: LOGS_PREFIX } = getPrefixes(message.guild.id);
  if (!content.startsWith(LOGS_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(LOGS_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!handlers[cmd]) return;

  return handlers[cmd](client, message, args, LOGS_PREFIX);
}

module.exports = { handleLogsTextCommand };
