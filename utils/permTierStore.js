const fs = require("fs");
const path = require("path");
const { PermissionFlagsBits } = require("discord.js");

// Permissions natives qui trahissent un rôle "staff" — sert à filtrer les
// rôles purement cosmétiques/organisationnels (ex: un rôle "robots" qui
// étiquette des bots, ou un rôle "membre" de base donné à tout le monde) qui
// se retrouvaient inclus par le seul tri par position dans la hiérarchie.
const STAFF_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.MentionEveryone,
];

// Système de paliers de permission (`&perms`) : chaque palier débloque un
// jeu CUMULATIF de commandes (le palier 3 a aussi tout ce que le palier 1 et
// 2 ont), et est associé automatiquement à des rôles du serveur en fonction
// de leur position dans la hiérarchie (le rôle le plus haut placé récupère
// le palier le plus élevé). Volontairement indépendant du système de
// délégation par commande (voir utils/commandPermissionStore.js) — pas de
// mélange entre les deux, utils/permissions.js vérifie simplement les deux.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "permTiers.json");

// Définition fixe des paliers — 5 niveaux, adaptés au jeu de commandes de
// modération du bot Musique (nettement plus petit que la référence à 12
// paliers) : chaque niveau ajoute quelques commandes de plus.
const TIER_DEFINITIONS = [
  { level: 1, label: "Palier 1 — Junior", commands: ["clear", "listbienvenue", "helpall"] },
  { level: 2, label: "Palier 2 — Modérateur", commands: ["hide", "unhide", "lock", "unlock", "renew"] },
  { level: 3, label: "Palier 3 — Modérateur senior", commands: ["massrole", "setbienvenue", "addbienvenue", "delbienvenue"] },
  { level: 4, label: "Palier 4 — Administrateur", commands: ["ban", "unban", "unbanall"] },
  { level: 5, label: "Palier 5 — Direction", commands: ["banall", "panel", "perms"] },
];
const TIER_COUNT = TIER_DEFINITIONS.length;

/**
 * @param {number} level
 * @returns {string[]} toutes les commandes débloquées à ce palier ET en dessous
 */
function getCumulativeCommands(level) {
  const commands = new Set();
  for (const tier of TIER_DEFINITIONS) {
    if (tier.level <= level) tier.commands.forEach((c) => commands.add(c));
  }
  return [...commands];
}

function tierHasCommand(level, command) {
  return getCumulativeCommands(level).includes(command);
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[permTierStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ [roleId: string]: number }} rôle -> numéro de palier
 */
function getRoleTiers(guildId) {
  return { ...(load()[guildId] || {}) };
}

/**
 * Remplace la correspondance complète rôle -> palier (un resync recalcule
 * tout, pas un diff).
 * @param {string} guildId
 * @param {{ [roleId: string]: number }} mapping
 */
function setRoleTiers(guildId, mapping) {
  const data = load();
  data[guildId] = mapping;
  save();
}

/**
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @returns {number} le palier le plus élevé parmi les rôles du membre (0 = aucun)
 */
function getMemberTier(guildId, member) {
  const mapping = getRoleTiers(guildId);
  let highest = 0;
  for (const role of member.roles.cache.values()) {
    const tier = mapping[role.id];
    if (tier && tier > highest) highest = tier;
  }
  return highest;
}

/**
 * Recalcule la correspondance rôle -> palier à partir de la hiérarchie
 * actuelle du serveur, en ne retenant que les rôles qui ressemblent
 * vraiment à des rôles de staff : hors @everyone, hors rôles gérés par une
 * intégration (bot, boost...), hors rôles qui n'ont AUCUNE permission
 * "staff" (voir STAFF_PERMISSIONS — élimine les rôles cosmétiques/tags même
 * hauts placés), et hors rôles qui ne sont portés que par des bots (un rôle
 * "robots" avec une permission de gestion n'est pas un palier de modération
 * humain). Les rôles retenus sont ensuite triés par position et répartis en
 * TIER_COUNT groupes de taille égale, les plus hauts placés récupérant les
 * paliers les plus élevés.
 * @param {import('discord.js').Guild} guild
 * @returns {{ [roleId: string]: number }}
 */
function autoSyncFromHierarchy(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .filter((r) => STAFF_PERMISSIONS.some((p) => r.permissions.has(p)))
    .filter((r) => r.members.size === 0 || [...r.members.values()].some((m) => !m.user.bot))
    .sort((a, b) => b.position - a.position);

  const mapping = {};
  if (roles.length) {
    const perTier = Math.ceil(roles.length / TIER_COUNT);
    roles.forEach((role, index) => {
      const groupFromTop = Math.floor(index / perTier);
      mapping[role.id] = Math.max(1, TIER_COUNT - groupFromTop);
    });
  }
  setRoleTiers(guild.id, mapping);
  return mapping;
}

function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = {
  TIER_DEFINITIONS,
  getCumulativeCommands,
  tierHasCommand,
  getRoleTiers,
  setRoleTiers,
  getMemberTier,
  autoSyncFromHierarchy,
  getRawGuildData,
  hydrateFromRemote,
};
