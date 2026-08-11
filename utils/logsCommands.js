const { handleLogsCommand } = require("./logsPanel");
const { buildHelpPanel } = require("./helpPanels");

// Préfixe fixe, non configurable : ce bot est entièrement dédié aux logs.
const LOGS_PREFIX = "=";

function buildLogsHelpPanel() {
  return buildHelpPanel({
    title: "Aide — Bot Logs",
    intro: "Préfixe : `=`",
    sections: [
      {
        heading: "Logs",
        lines: [
          "`=logs` — Choisit le salon de destination par catégorie (modération, salon, rôles, sécurité, blacklist)",
        ],
      },
    ],
    footer: "Réservé aux owners anti-nuke de ce serveur (voir `=owner` sur le bot Antifast).",
  });
}

const handlers = {
  help: (client, message) => message.channel.send(buildLogsHelpPanel()),
  logs: (client, message) => handleLogsCommand(message),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Logs.
 */
async function handleLogsTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  if (!content.startsWith(LOGS_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(LOGS_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!handlers[cmd]) return;

  return handlers[cmd](client, message, args);
}

module.exports = { handleLogsTextCommand };
