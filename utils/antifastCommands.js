const { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand, handleAllBotsCommand } = require("./antiNukeCommands");
const { buildHelpPanel } = require("./helpPanels");
const { getPrefixes } = require("./prefixStore");
const { waitForHydration, saveGuildConfig } = require("./configChannel");
const { buildStatusEmbed } = require("./statusEmbed");
const { parseDuration, formatDuration } = require("./duration");
const {
  isOwner,
  getModuleOverride,
  setModuleOverride,
  getMinAccountAgeMs,
  setMinAccountAgeMs,
  getPingRaidRoleId,
  setPingRaidRoleId,
  getPunition,
  setPunition,
} = require("./antiNukeStore");

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
      {
        heading: "Raccourcis anti-*",
        lines: [
          `\`${prefix}antiban on|off\`, \`antibot\`, \`antichannel\`, \`antideco\`, \`antieveryone\`, \`antijoin\`, \`antikick\`, \`antilink\`, \`antirole\`, \`antiunban\`, \`antiupdate\`, \`antiwebhook\` — active/désactive un module précis sans passer par le panel (sans argument : affiche l'état actuel)`,
          `\`${prefix}creation <durée|off>\` — Âge minimum de compte pour rejoindre sans être expulsé (ex : \`creation 7j\`)`,
          `\`${prefix}pingraid @role|off\` — Rôle pingé en plus du log lors d'une alerte anti-raid`,
          `\`${prefix}punition derank|kick|ban|mute\` — Sanction appliquée par défaut quand un module se déclenche (derank par défaut)`,
        ],
      },
    ],
    footer: `Réservé aux owners anti-nuke de ce serveur, sauf mention contraire (voir \`${prefix}owner\`).`,
  });
}

// Chaque raccourci "anti-*" agit sur un ou plusieurs modules du moteur
// existant (voir utils/antiNukeModules.js/antiNuke.js) — évite de passer par
// le panel `=antifast` > Avancé pour un simple on/off.
const ANTI_TOGGLE_MODULES = {
  antiban: ["ban"],
  antibot: ["botAdd"],
  antichannel: ["channelCreate", "channelDelete", "channelUpdate", "channelPermissionUpdate"],
  antideco: ["voiceDisconnect"],
  antieveryone: ["everyoneMention"],
  antijoin: ["raidJoin"],
  antikick: ["kick"],
  antilink: ["linkSpam"],
  antirole: ["roleCreate", "roleDelete", "roleUpdate", "roleAdminGrant"],
  antiupdate: ["guildUpdate"],
  antiwebhook: ["webhookCreate"],
  antiunban: ["unban"],
};

function requireOwner(message) {
  if (!isOwner(message.guild, message.author.id)) {
    message.reply({ embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke de ce serveur (voir `=owner`).")] });
    return false;
  }
  return true;
}

async function handleAntiToggle(message, args, cmd) {
  if (!requireOwner(message)) return;
  const moduleKeys = ANTI_TOGGLE_MODULES[cmd];
  const currentlyPaused = Boolean(getModuleOverride(message.guild.id, moduleKeys[0]).paused);

  const arg = (args[0] || "").toLowerCase();
  let nextPaused;
  if (!arg) {
    return message.reply({
      embeds: [buildStatusEmbed("info", `\`${cmd}\` est actuellement **${currentlyPaused ? "désactivé" : "activé"}**. Utilise \`on\`/\`off\` pour changer.`)],
    });
  }
  if (arg === "on") nextPaused = false;
  else if (arg === "off") nextPaused = true;
  else return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : \`${cmd} on\` ou \`${cmd} off\`.`)] });

  for (const key of moduleKeys) setModuleOverride(message.guild.id, key, { paused: nextPaused });
  await saveGuildConfig(message.guild, ["antiNuke"]);
  await message.reply({ embeds: [buildStatusEmbed("success", `\`${cmd}\` ${nextPaused ? "désactivé" : "activé"}.`)] });
}

async function handleCreation(message, args, prefix) {
  if (!requireOwner(message)) return;
  const arg = (args[0] || "").toLowerCase();
  if (!arg) {
    const ms = getMinAccountAgeMs(message.guild.id);
    return message.reply({
      embeds: [buildStatusEmbed("info", ms ? `Âge minimum requis pour rejoindre : **${formatDuration(ms)}**.` : "Aucune limite configurée.")],
    });
  }
  if (arg === "off") {
    setMinAccountAgeMs(message.guild.id, 0);
    await saveGuildConfig(message.guild, ["antiNuke"]);
    return message.reply({ embeds: [buildStatusEmbed("success", "Limite d'âge de compte désactivée.")] });
  }
  const ms = parseDuration(arg);
  if (!ms) {
    return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : \`${prefix}creation <durée>\` (ex : \`${prefix}creation 7j\`) ou \`${prefix}creation off\`.`)] });
  }
  setMinAccountAgeMs(message.guild.id, ms);
  await saveGuildConfig(message.guild, ["antiNuke"]);
  await message.reply({ embeds: [buildStatusEmbed("success", `Âge minimum requis pour rejoindre : **${formatDuration(ms)}**.`)] });
}

async function handlePingRaid(message, args, prefix) {
  if (!requireOwner(message)) return;
  if ((args[0] || "").toLowerCase() === "off") {
    setPingRaidRoleId(message.guild.id, null);
    await saveGuildConfig(message.guild, ["antiNuke"]);
    return message.reply({ embeds: [buildStatusEmbed("success", "Rôle anti-raid retiré.")] });
  }
  const role = message.mentions.roles?.first();
  if (!role) {
    const roleId = getPingRaidRoleId(message.guild.id);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          roleId ? `Rôle pingé en cas d'alerte : <@&${roleId}>.` : `Aucun rôle configuré. Utilisation : \`${prefix}pingraid @role\` (ou \`off\`).`
        ),
      ],
    });
  }
  setPingRaidRoleId(message.guild.id, role.id);
  await saveGuildConfig(message.guild, ["antiNuke"]);
  await message.reply({ embeds: [buildStatusEmbed("success", `${role} sera pingé en plus du log lors d'une alerte anti-raid.`)] });
}

const VALID_PUNITIONS = ["derank", "kick", "ban", "mute"];

async function handlePunition(message, args, prefix) {
  if (!requireOwner(message)) return;
  const arg = (args[0] || "").toLowerCase();
  if (!arg) {
    return message.reply({
      embeds: [buildStatusEmbed("info", `Sanction actuelle : **${getPunition(message.guild.id)}**. Utilisation : \`${prefix}punition derank|kick|ban|mute\`.`)],
    });
  }
  if (!VALID_PUNITIONS.includes(arg)) {
    return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : \`${prefix}punition derank|kick|ban|mute\`.`)] });
  }
  setPunition(message.guild.id, arg);
  await saveGuildConfig(message.guild, ["antiNuke"]);
  await message.reply({ embeds: [buildStatusEmbed("success", `Sanction par défaut réglée sur **${arg}**.`)] });
}

const handlers = {
  help: (client, message, args, prefix) => message.channel.send(buildAntifastHelpPanel(prefix)),
  antifast: (client, message, args) => handleAntifastCommand(message, args),
  owner: (client, message, args) => handleOwnerCommand(message, args),
  wl: (client, message, args) => handleWhitelistCommand(message, args),
  allbots: (client, message) => handleAllBotsCommand(message),
  creation: (client, message, args, prefix) => handleCreation(message, args, prefix),
  pingraid: (client, message, args, prefix) => handlePingRaid(message, args, prefix),
  punition: (client, message, args, prefix) => handlePunition(message, args, prefix),
};
for (const cmd of Object.keys(ANTI_TOGGLE_MODULES)) {
  handlers[cmd] = (client, message, args) => handleAntiToggle(message, args, cmd);
}

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
