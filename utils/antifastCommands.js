const { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand, handleAllBotsCommand } = require("./antiNukeCommands");
const { buildHelpPanel } = require("./helpPanels");
const { getPrefixes } = require("./prefixStore");
const { waitForHydration } = require("./configChannel");

function buildAntifastHelpPanel(prefix) {
  return buildHelpPanel({
    title: "Aide — Bot Antifast",
    intro: `Préfixe : \`${prefix}\``,
    sections: [
      {
        heading: "Anti-nuke",
        lines: [
          `\`${prefix}antifast\` — Panel (statut, activer/désactiver, owners, whitelist, avancé). \`${prefix}antifast on|off\` en raccourci direct`,
          `\`${prefix}owner add|remove|list [@membre]\` — Qui peut configurer ce bot (réservé au propriétaire réel du serveur)`,
          `\`${prefix}wl add|remove|list [@membre] [module|catégorie|all]\` — Exempte un membre d'un ou plusieurs modules anti-nuke précis (\`all\` par défaut)`,
          `\`${prefix}allbots\` — Liste tous les bots du serveur (repérer un ajout suspect)`,
        ],
      },
    ],
    footer: `Réservé aux owners anti-nuke de ce serveur, sauf mention contraire (voir \`${prefix}owner\`).`,
  });
}

const handlers = {
  help: (client, message, args, prefix) => message.channel.send(buildAntifastHelpPanel(prefix)),
  antifast: (client, message, args) => handleAntifastCommand(message, args),
  owner: (client, message, args) => handleOwnerCommand(message, args),
  wl: (client, message, args) => handleWhitelistCommand(message, args),
  allbots: (client, message) => handleAllBotsCommand(message),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Antifast. Le préfixe est
 * configurable par serveur via `.panel` (bot Musique+Modération) — voir
 * utils/prefixStore.js/prefixPanel.js.
 */
async function handleAntifastTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  // Si le bot vient de redémarrer, attend que le préfixe ait fini d'être
  // restauré depuis Discord avant de le lire (voir utils/configChannel.js).
  await waitForHydration(message.guild.id);

  const content = message.content.trim();
  const { antifast: ANTIFAST_PREFIX } = getPrefixes(message.guild.id);
  if (!content.startsWith(ANTIFAST_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(ANTIFAST_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!handlers[cmd]) return;

  return handlers[cmd](client, message, args, ANTIFAST_PREFIX);
}

module.exports = { handleAntifastTextCommand };
