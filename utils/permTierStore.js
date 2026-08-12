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

// Système de paliers de permission (`&perms`/`&helpall`, gérable aussi via
// `&panel` > Paliers) : chaque palier débloque un jeu CUMULATIF de commandes
// (le palier 3 a aussi tout ce que le palier 1 et 2 ont), et est associé à
// des rôles du serveur (auto-assignés selon leur position dans la
// hiérarchie, ou modifiables à la main). Volontairement indépendant du
// système de délégation par commande (voir utils/commandPermissionStore.js)
// — pas de mélange entre les deux, utils/permissions.js vérifie les deux.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "permTiers.json");

// Définition par défaut des paliers — 5 niveaux, adaptés au jeu de
// commandes de modération du bot Musique. Ce sont des valeurs par défaut :
// `&panel` > Paliers permet de réassigner une commande à un autre palier
// par serveur (voir getCommandTierOverrides/setCommandTier ci-dessous).
const TIER_DEFINITIONS = [
  { level: 1, label: "Permission 1 — Utilisateur", commands: ["clear", "listbienvenue", "helpall"] },
  { level: 2, label: "Permission 2 — Modération de base", commands: ["hide", "unhide", "lock", "unlock", "renew"] },
  { level: 3, label: "Permission 3 — Modération avancée", commands: ["massrole", "greet", "addbienvenue", "delbienvenue"] },
  { level: 4, label: "Permission 4 — Administration", commands: ["ban", "unban", "unbanall"] },
  { level: 5, label: "Permission 5 — Owner Global", commands: ["banall", "panel", "perms", "say"] },
];
const TIER_COUNT = TIER_DEFINITIONS.length;
// Toutes les commandes qui participent au système de paliers (union des
// valeurs par défaut) — sert de liste d'options pour `&panel` > Paliers.
const ALL_TIER_COMMANDS = TIER_DEFINITIONS.flatMap((t) => t.commands);

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

function ensureGuild(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { roles: {}, commands: {}, extraTiers: [] };
  if (!data[guildId].roles) data[guildId].roles = {};
  if (!data[guildId].commands) data[guildId].commands = {};
  if (!data[guildId].extraTiers) data[guildId].extraTiers = [];
  return data[guildId];
}

/**
 * Paliers ajoutés par ce serveur en plus des 5 par défaut (voir
 * TIER_DEFINITIONS) — `&panel` > Paliers permet d'en créer autant que
 * voulu (ex: palier 6, 7, 8...), sans commandes par défaut : à cocher
 * ensuite via le menu de commandes de ce palier.
 * @param {string} guildId
 * @returns {{ level: number, label: string }[]}
 */
function getExtraTiers(guildId) {
  return [...ensureGuild(guildId).extraTiers];
}

/**
 * @param {string} guildId
 * @returns {{ level: number, label: string }[]} les 5 paliers par défaut +
 *   les paliers ajoutés par ce serveur, triés par niveau
 */
function getAllTierDefinitions(guildId) {
  return [...TIER_DEFINITIONS.map((t) => ({ level: t.level, label: t.label })), ...getExtraTiers(guildId)].sort(
    (a, b) => a.level - b.level
  );
}

/**
 * Crée un nouveau palier (niveau suivant le plus haut existant sur ce
 * serveur) — utilisé par `&panel` > Paliers.
 * @param {string} guildId
 * @param {string} [label]
 * @returns {number} le niveau du palier créé
 */
function addTier(guildId, label) {
  const existing = getAllTierDefinitions(guildId);
  const nextLevel = existing.length ? Math.max(...existing.map((t) => t.level)) + 1 : 1;
  const g = ensureGuild(guildId);
  g.extraTiers.push({ level: nextLevel, label: label?.trim() || `Permission ${nextLevel}` });
  save();
  return nextLevel;
}

/**
 * Supprime un palier ajouté par ce serveur (les 5 paliers par défaut ne
 * peuvent pas être supprimés). Les rôles/commandes qui y étaient assignés
 * restent à ce niveau (invisibles tant qu'aucun palier n'a ce niveau) —
 * à réassigner à la main si besoin.
 * @param {string} guildId
 * @param {number} level
 * @returns {boolean} true si un palier correspondant a été supprimé
 */
function removeTier(guildId, level) {
  const g = ensureGuild(guildId);
  const before = g.extraTiers.length;
  g.extraTiers = g.extraTiers.filter((t) => t.level !== level);
  save();
  return g.extraTiers.length < before;
}

/**
 * @param {string} guildId
 * @returns {{ [roleId: string]: number }} rôle -> numéro de palier
 */
function getRoleTiers(guildId) {
  return { ...ensureGuild(guildId).roles };
}

/**
 * Remplace la correspondance complète rôle -> palier (un resync recalcule
 * tout, pas un diff).
 * @param {string} guildId
 * @param {{ [roleId: string]: number }} mapping
 */
function setRoleTiers(guildId, mapping) {
  const data = load();
  ensureGuild(guildId).roles = mapping;
  save();
}

/**
 * Assigne un seul rôle à un palier (retire des autres implicitement, un
 * rôle n'a qu'un seul palier à la fois) — utilisé par `&panel` > Paliers.
 * @param {string} guildId
 * @param {string} roleId
 * @param {number} level
 */
function setRoleTier(guildId, roleId, level) {
  const g = ensureGuild(guildId);
  g.roles[roleId] = level;
  save();
}

/**
 * @param {string} guildId
 * @param {string} roleId
 */
function removeRoleTier(guildId, roleId) {
  const g = ensureGuild(guildId);
  delete g.roles[roleId];
  save();
}

/**
 * @param {string} guildId
 * @returns {{ [command: string]: number }} commande -> palier, uniquement
 *   les commandes réassignées à la main (voir getCommandTierMap pour la
 *   vue complète fusionnée avec les valeurs par défaut)
 */
function getCommandTierOverrides(guildId) {
  return { ...ensureGuild(guildId).commands };
}

/**
 * Réassigne une commande à un palier différent des valeurs par défaut
 * (voir TIER_DEFINITIONS) — utilisé par `&panel` > Paliers.
 * @param {string} guildId
 * @param {string} command
 * @param {number} level
 */
function setCommandTier(guildId, command, level) {
  const g = ensureGuild(guildId);
  g.commands[command] = level;
  save();
}

/**
 * @param {string} guildId
 * @returns {{ [command: string]: number }} commande -> palier, valeurs par
 *   défaut (TIER_DEFINITIONS) fusionnées avec les réassignations du serveur
 */
function getCommandTierMap(guildId) {
  const map = {};
  for (const tier of TIER_DEFINITIONS) {
    for (const cmd of tier.commands) map[cmd] = tier.level;
  }
  Object.assign(map, getCommandTierOverrides(guildId));
  return map;
}

/**
 * @param {string} guildId
 * @param {number} level
 * @returns {string[]} toutes les commandes débloquées à ce palier ET en dessous
 */
function getCumulativeCommands(guildId, level) {
  const map = getCommandTierMap(guildId);
  return Object.entries(map)
    .filter(([, cmdLevel]) => cmdLevel <= level)
    .map(([cmd]) => cmd);
}

/**
 * @param {string} guildId
 * @param {number} level
 * @param {string} command
 * @returns {boolean}
 */
function tierHasCommand(guildId, level, command) {
  const cmdLevel = getCommandTierMap(guildId)[command];
  return cmdLevel !== undefined && cmdLevel <= level;
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
 * autant de groupes que ce serveur a de paliers (voir getAllTierDefinitions
 * — 5 par défaut, plus si des paliers ont été ajoutés), les plus hauts
 * placés récupérant les paliers les plus élevés.
 * @param {import('discord.js').Guild} guild
 * @returns {{ [roleId: string]: number }}
 */
function autoSyncFromHierarchy(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .filter((r) => STAFF_PERMISSIONS.some((p) => r.permissions.has(p)))
    .filter((r) => r.members.size === 0 || [...r.members.values()].some((m) => !m.user.bot))
    .sort((a, b) => b.position - a.position);

  const tierCount = getAllTierDefinitions(guild.id).length || TIER_COUNT;
  const mapping = {};
  if (roles.length) {
    const perTier = Math.ceil(roles.length / tierCount);
    roles.forEach((role, index) => {
      const groupFromTop = Math.floor(index / perTier);
      mapping[role.id] = Math.max(1, tierCount - groupFromTop);
    });
  }
  setRoleTiers(guild.id, mapping);
  return mapping;
}

function getRawGuildData(guildId) {
  return load()[guildId] || { roles: {}, commands: {}, extraTiers: [] };
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = {
  TIER_DEFINITIONS,
  ALL_TIER_COMMANDS,
  getCumulativeCommands,
  tierHasCommand,
  getRoleTiers,
  setRoleTiers,
  setRoleTier,
  removeRoleTier,
  getCommandTierOverrides,
  setCommandTier,
  getCommandTierMap,
  getMemberTier,
  autoSyncFromHierarchy,
  getExtraTiers,
  getAllTierDefinitions,
  addTier,
  removeTier,
  getRawGuildData,
  hydrateFromRemote,
};
