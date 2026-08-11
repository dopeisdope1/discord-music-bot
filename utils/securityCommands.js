const { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand, handleAllBotsCommand } = require("./antiNukeCommands");
const { handleBlacklistCommand } = require("./blacklistCommands");
const { handleLogsCommand } = require("./logsPanel");
const { buildHelpPanel } = require("./helpPanels");

// Préfixe fixe, non configurable (pas de .panel pour ce bot) : ce bot est
// entièrement dédié à la sécurité, pas besoin de le personnaliser par serveur.
const SECURITY_PREFIX = "=";

function buildSecurityHelpPanel() {
  return buildHelpPanel({
    title: "Aide — Bot Sécurité",
    intro: "Préfixe : `=`",
    sections: [
      {
        heading: "Anti-nuke",
        lines: [
          "`=antifast` — Panel (statut, activer/désactiver, owners, whitelist, avancé). `=antifast on|off` en raccourci direct",
          "`=owner add|remove|list [@membre]` — Qui peut configurer ce bot (réservé au propriétaire réel du serveur)",
          "`=wl add|remove|list [@membre] [module|catégorie|all]` — Exempte un membre d'un ou plusieurs modules anti-nuke précis (`all` par défaut)",
          "`=allbots` — Liste tous les bots du serveur (repérer un ajout suspect)",
        ],
      },
      {
        heading: "Blacklist",
        lines: [
          "`=blacklist add @membre|<id> [raison]` — Ajoute à la blacklist (banni tout de suite si déjà présent, banni automatiquement à l'arrivée sinon)",
          "`=blacklist remove @membre|<id>` — Retire de la blacklist",
          "`=blacklist check @membre|<id>` — Vérifie si quelqu'un est blacklisté",
          "`=blacklist list` — Liste la blacklist du serveur",
        ],
      },
      {
        heading: "Logs",
        lines: ["`=logs` — Choisit le salon de logs par catégorie (modération, salon, rôles, sécurité, blacklist)"],
      },
    ],
    footer: "Réservé aux owners anti-nuke de ce serveur, sauf mention contraire (voir `=owner`).",
  });
}

const handlers = {
  help: (client, message) => message.channel.send(buildSecurityHelpPanel()),
  antifast: (client, message, args) => handleAntifastCommand(message, args),
  owner: (client, message, args) => handleOwnerCommand(message, args),
  wl: (client, message, args) => handleWhitelistCommand(message, args),
  allbots: (client, message) => handleAllBotsCommand(message),
  blacklist: (client, message, args) => handleBlacklistCommand(message, args),
  logs: (client, message) => handleLogsCommand(message),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Sécurité.
 */
async function handleSecurityTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  if (!content.startsWith(SECURITY_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(SECURITY_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!handlers[cmd]) return;

  return handlers[cmd](client, message, args);
}

module.exports = { handleSecurityTextCommand };
