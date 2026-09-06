const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const guardConfig = require("./guard/config");
const antiSpam = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");
const { getAllLogChannels } = require("./modLogStore");
const muteStore = require("./muteStore");

// Permissions dont la présence sur un rôle largement distribué (ou sur
// @everyone) mérite d'être signalée — même liste que celle demandée pour la
// protection contre les permissions dangereuses.
const DANGEROUS_PERMS = [
  ["Administrator", PermissionFlagsBits.Administrator],
  ["Gérer le serveur", PermissionFlagsBits.ManageGuild],
  ["Gérer les rôles", PermissionFlagsBits.ManageRoles],
  ["Gérer les salons", PermissionFlagsBits.ManageChannels],
  ["Gérer les webhooks", PermissionFlagsBits.ManageWebhooks],
  ["Bannir des membres", PermissionFlagsBits.BanMembers],
  ["Expulser des membres", PermissionFlagsBits.KickMembers],
  ["Modérer les membres", PermissionFlagsBits.ModerateMembers],
  ["Gérer les messages", PermissionFlagsBits.ManageMessages],
  ["Mentionner @everyone", PermissionFlagsBits.MentionEveryone],
];

/**
 * &security scan — audit en lecture seule (aucune modification), combine
 * des réglages déjà stockés ailleurs (anti-nuke, automod, logs, mute role,
 * permissions des rôles) en un rapport unique. Ne remplace aucun de ces
 * systèmes, se contente de les résumer au même endroit.
 */
async function securityScan(client, message) {
  if (!can(message.member, "server.security.scan")) return;
  const guild = message.guild;

  const critical = [];
  const warnings = [];
  const ok = [];

  // --- @everyone ---
  const everyoneDangerous = DANGEROUS_PERMS.filter(([, flag]) => guild.roles.everyone.permissions.has(flag));
  if (everyoneDangerous.length) {
    critical.push(`@everyone possède : ${everyoneDangerous.map(([label]) => label).join(", ")} — accessible à absolument tout le monde.`);
  } else {
    ok.push("@everyone n'a aucune permission dangereuse.");
  }

  // --- Rôles avec Administrator ---
  const adminRoles = guild.roles.cache.filter((r) => !r.managed && r.id !== guild.id && r.permissions.has(PermissionFlagsBits.Administrator));
  if (adminRoles.size) {
    warnings.push(`${adminRoles.size} rôle(s) non géré(s) par une appli ont Administrator : ${[...adminRoles.values()].map((r) => r.name).join(", ")}.`);
  } else {
    ok.push("Aucun rôle (hors intégrations) n'a Administrator.");
  }

  // --- Bots avec Administrator ---
  await guild.members.fetch().catch(() => {});
  const adminBots = guild.members.cache.filter((m) => m.user.bot && m.permissions.has(PermissionFlagsBits.Administrator));
  if (adminBots.size) {
    warnings.push(`${adminBots.size} bot(s) ont Administrator : ${[...adminBots.values()].map((m) => m.user.tag).join(", ")}.`);
  } else {
    ok.push("Aucun bot n'a Administrator.");
  }

  // --- Anti-nuke ---
  const guardCfg = guardConfig.getConfig(guild.id);
  if (guardCfg.enabled) ok.push("Anti-nuke activé.");
  else warnings.push("Anti-nuke désactivé — `antinuke on` pour l'activer (voir `&panel` > Protection).");

  // --- AutoMod (anti-spam/anti-lien/anti-mention/mots interdits) ---
  const automodStates = {
    "Anti-spam": antiSpam.getConfig(guild.id).enabled,
    "Anti-lien": antiLink.getConfig(guild.id).enabled,
    "Anti-mass-mention": antiMention.getConfig(guild.id).enabled,
    "Mots interdits": badWords.getConfig(guild.id).enabled,
  };
  const automodOff = Object.entries(automodStates).filter(([, on]) => !on).map(([name]) => name);
  if (automodOff.length === Object.keys(automodStates).length) {
    warnings.push("Tout l'AutoMod est désactivé (anti-spam, anti-lien, anti-mass-mention, mots interdits).");
  } else if (automodOff.length) {
    ok.push(`AutoMod partiellement actif — désactivé : ${automodOff.join(", ")}.`);
  } else {
    ok.push("AutoMod entièrement actif (anti-spam, anti-lien, anti-mass-mention, mots interdits).");
  }

  // --- Logs ---
  const logChannels = Object.values(getAllLogChannels(guild.id)).filter(Boolean);
  if (!logChannels.length) warnings.push("Aucun salon de logs configuré — `&panel` > Logs pour en créer.");
  else ok.push(`${logChannels.length} catégorie(s) de logs configurée(s).`);

  // --- Rôle de mute ---
  const muteRoleId = muteStore.getMuteRoleId(guild.id);
  if (!muteRoleId) warnings.push("Aucun rôle de mute configuré (`set muterole @rôle`) — &mute/&tempmute/&cmute restent inutilisables.");
  else if (!guild.roles.cache.has(muteRoleId)) warnings.push("Le rôle de mute configuré n'existe plus sur le serveur.");
  else ok.push("Rôle de mute configuré et valide.");

  const emoji = critical.length ? "🔴" : warnings.length ? "🟠" : "🟢";
  const lines = [
    `${emoji} **${ok.length}** contrôle(s) OK · **${warnings.length}** avertissement(s) · **${critical.length}** problème(s) critique(s)`,
    "",
  ];
  if (critical.length) lines.push("**🔴 Critique :**", ...critical.map((l) => `> ${l}`), "");
  if (warnings.length) lines.push("**🟠 Avertissements :**", ...warnings.map((l) => `> ${l}`), "");
  lines.push("**🟢 OK :**", ...ok.map((l) => `> ${l}`));

  await message.reply({ embeds: [buildStatusEmbed("info", lines.join("\n"), { title: "Sécurité du serveur" })] });
}

module.exports = { securityScan };
