const { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand, handleAllBotsCommand } = require("./antiNukeCommands");
const { buildHelpPanel } = require("./helpPanels");

// Préfixe fixe, non configurable : ce bot est entièrement dédié à l'anti-nuke.
const ANTIFAST_PREFIX = "=";

function buildAntifastHelpPanel() {
  return buildHelpPanel({
    title: "Aide — Bot Antifast",
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
    ],
    footer: "Réservé aux owners anti-nuke de ce serveur, sauf mention contraire (voir `=owner`).",
  });
}

const handlers = {
  help: (client, message) => message.channel.send(buildAntifastHelpPanel()),
  antifast: (client, message, args) => handleAntifastCommand(message, args),
  owner: (client, message, args) => handleOwnerCommand(message, args),
  wl: (client, message, args) => handleWhitelistCommand(message, args),
  allbots: (client, message) => handleAllBotsCommand(message),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Antifast.
 */
async function handleAntifastTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  if (!content.startsWith(ANTIFAST_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(ANTIFAST_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!handlers[cmd]) return;

  return handlers[cmd](client, message, args);
}

module.exports = { handleAntifastTextCommand };
