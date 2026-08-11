const fs = require("fs");
const path = require("path");
const { ALL_MODULES } = require("./antiNukeModules");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "antiNuke.json");

// IDs Discord (séparés par des virgules) du/des propriétaire(s) du BOT — pas
// forcément le "propriétaire" Discord de tel ou tel serveur où il tourne.
// Un bot owner a accès à `.owner`/`.antifast`/`.wl` sur TOUS les serveurs,
// peu importe qui en est le propriétaire côté Discord. Voir README.
const BOT_OWNER_IDS = (process.env.BOT_OWNER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * @param {string} userId
 * @returns {boolean}
 */
function isBotOwner(userId) {
  return BOT_OWNER_IDS.includes(userId);
}

/**
 * @returns {string[]}
 */
function getBotOwnerIds() {
  return [...BOT_OWNER_IDS];
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
    console.error("[antiNukeStore] échec de la sauvegarde :", err);
  }
}

const DEFAULT_GUILD_DATA = () => ({
  enabled: true,
  owners: [],
  whitelist: {},
  roleBypass: [],
  categoryBypass: [],
  moduleOverrides: {},
  autoRestoreMs: 0,
  pendingRestores: [],
  minAccountAgeMs: 0,
  pingRaidRoleId: null,
  punition: "derank",
});

function guildData(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = DEFAULT_GUILD_DATA();
  const g = data[guildId];
  // Migration depuis l'ancien format (whitelist: string[] à plat, exemption
  // totale) vers le nouveau (whitelist: { [userId]: string[] modules }) —
  // au premier accès après mise à jour du bot, convertit chaque ancienne
  // entrée en "all" pour ne rien perdre.
  if (Array.isArray(g.whitelist)) {
    const migrated = {};
    for (const userId of g.whitelist) migrated[userId] = ["all"];
    g.whitelist = migrated;
  }
  // Complète les champs manquants pour une config sauvegardée avant l'ajout
  // du bypass rôles/catégories, des seuils par module et de la réactivation
  // automatique (voir hydrateFromRemote — un vieux blob restauré depuis
  // Discord n'a pas ces clés).
  if (!g.roleBypass) g.roleBypass = [];
  if (!g.categoryBypass) g.categoryBypass = [];
  if (!g.moduleOverrides) g.moduleOverrides = {};
  if (!g.autoRestoreMs) g.autoRestoreMs = 0;
  if (!g.pendingRestores) g.pendingRestores = [];
  if (g.minAccountAgeMs === undefined) g.minAccountAgeMs = 0;
  if (g.pingRaidRoleId === undefined) g.pingRaidRoleId = null;
  if (!g.punition) g.punition = "derank";
  return g;
}

/**
 * @param {string} guildId
 * @returns {boolean} activé par défaut tant que personne n'y a touché
 */
function isEnabled(guildId) {
  return guildData(guildId).enabled;
}

/**
 * @param {string} guildId
 * @param {boolean} enabled
 */
function setEnabled(guildId, enabled) {
  const g = guildData(guildId);
  g.enabled = enabled;
  save();
}

/**
 * @param {string} guildId
 * @returns {string[]}
 */
function getOwners(guildId) {
  return [...guildData(guildId).owners];
}

function addOwner(guildId, userId) {
  const g = guildData(guildId);
  if (!g.owners.includes(userId)) g.owners.push(userId);
  save();
}

function removeOwner(guildId, userId) {
  const g = guildData(guildId);
  g.owners = g.owners.filter((id) => id !== userId);
  save();
}

/**
 * "Owner" au sens anti-nuke : le vrai propriétaire Discord du serveur,
 * quelqu'un qu'il a explicitement ajouté via `.owner add`, ou un propriétaire
 * du bot lui-même (BOT_OWNER_IDS, valable sur tous les serveurs). Délibérément
 * séparé de la permission Discord native Administrateur et du système de
 * catégories `.panel` > Permissions — un compte admin compromis ne doit pas
 * pouvoir toucher à l'anti-nuke, seul ce cercle restreint le peut.
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @returns {boolean}
 */
function isOwner(guild, userId) {
  return userId === guild.ownerId || getOwners(guild.id).includes(userId) || isBotOwner(userId);
}

/**
 * @param {string} guildId
 * @returns {{ [userId: string]: string[] }} modules par membre whitelisté
 *   ("all" = tous les modules)
 */
function getWhitelist(guildId) {
  return { ...guildData(guildId).whitelist };
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @returns {string[]} modules dont ce membre est exempté (vide si pas whitelisté)
 */
function getWhitelistEntry(guildId, userId) {
  return [...(guildData(guildId).whitelist[userId] || [])];
}

/**
 * Ajoute un ou plusieurs modules à la whitelist d'un membre (fusionne avec
 * ses modules déjà présents). `modules` peut valoir `["all"]` pour tout
 * exempter d'un coup — dans ce cas ça remplace toute liste existante,
 * puisque "all" rend les entrées précédentes redondantes.
 * @param {string} guildId
 * @param {string} userId
 * @param {string[]} modules
 */
function addToWhitelist(guildId, userId, modules) {
  const g = guildData(guildId);
  if (modules.includes("all")) {
    g.whitelist[userId] = ["all"];
  } else {
    const current = new Set(g.whitelist[userId] || []);
    if (current.has("all")) current.delete("all");
    for (const m of modules) current.add(m);
    g.whitelist[userId] = [...current];
  }
  save();
}

/**
 * Retire un ou plusieurs modules de la whitelist d'un membre. `modules`
 * peut valoir `["all"]` pour le retirer entièrement de la whitelist, peu
 * importe ce qu'il avait.
 * @param {string} guildId
 * @param {string} userId
 * @param {string[]} modules
 */
function removeFromWhitelist(guildId, userId, modules) {
  const g = guildData(guildId);
  if (!g.whitelist[userId]) return;
  if (modules.includes("all")) {
    delete g.whitelist[userId];
  } else {
    const current = new Set(g.whitelist[userId]);
    // "all" équivaut à tous les modules : retirer un module précis d'une
    // entrée "all" la remplace par la liste complète moins ce module.
    if (current.has("all")) {
      current.delete("all");
      for (const m of ALL_MODULES) current.add(m);
    }
    for (const m of modules) current.delete(m);
    if (current.size === 0) delete g.whitelist[userId];
    else g.whitelist[userId] = [...current];
  }
  save();
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean} true s'il a au moins une entrée de whitelist (peu importe le module)
 */
function isWhitelisted(guildId, userId) {
  return Boolean(guildData(guildId).whitelist[userId]?.length);
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {string} moduleKey
 * @returns {boolean} true si ce membre est exempté de ce module précis (ou de "all")
 */
function isWhitelistedFor(guildId, userId, moduleKey) {
  const entry = guildData(guildId).whitelist[userId];
  if (!entry) return false;
  return entry.includes("all") || entry.includes(moduleKey);
}

/**
 * @param {string} guildId
 * @returns {string[]} IDs des rôles exemptés de tous les déclencheurs anti-nuke
 */
function getRoleBypass(guildId) {
  return [...guildData(guildId).roleBypass];
}

/**
 * Remplace la liste complète des rôles bypass (le menu de sélection envoie
 * toujours l'ensemble coché, pas un diff).
 * @param {string} guildId
 * @param {string[]} roleIds
 */
function setRoleBypass(guildId, roleIds) {
  const g = guildData(guildId);
  g.roleBypass = roleIds;
  save();
}

/**
 * @param {string} guildId
 * @returns {string[]} IDs des catégories dont les salons/threads sont exemptés
 *   des modules salons/catégories/threads
 */
function getCategoryBypass(guildId) {
  return [...guildData(guildId).categoryBypass];
}

/**
 * @param {string} guildId
 * @param {string[]} categoryIds
 */
function setCategoryBypass(guildId, categoryIds) {
  const g = guildData(guildId);
  g.categoryBypass = categoryIds;
  save();
}

/**
 * @param {string} guildId
 * @param {string} moduleKey
 * @returns {{ threshold?: number, windowMs?: number, paused?: boolean }} champs
 *   personnalisés pour ce module (vide si tout est par défaut)
 */
function getModuleOverride(guildId, moduleKey) {
  return { ...(guildData(guildId).moduleOverrides[moduleKey] || {}) };
}

/**
 * @param {string} guildId
 * @returns {{ [moduleKey: string]: { threshold?: number, windowMs?: number, paused?: boolean } }}
 */
function getAllModuleOverrides(guildId) {
  return { ...guildData(guildId).moduleOverrides };
}

/**
 * Fusionne `patch` dans la config existante d'un module (ne remplace que les
 * champs fournis).
 * @param {string} guildId
 * @param {string} moduleKey
 * @param {{ threshold?: number, windowMs?: number, paused?: boolean }} patch
 */
function setModuleOverride(guildId, moduleKey, patch) {
  const g = guildData(guildId);
  g.moduleOverrides[moduleKey] = { ...(g.moduleOverrides[moduleKey] || {}), ...patch };
  save();
}

/**
 * @param {string} guildId
 * @returns {number} délai (ms) avant réactivation auto des rôles retirés par
 *   l'anti-nuke — 0 = désactivé (retrait permanent tant qu'un admin ne les
 *   redonne pas à la main)
 */
function getAutoRestoreMs(guildId) {
  return guildData(guildId).autoRestoreMs || 0;
}

/**
 * @param {string} guildId
 * @param {number} ms
 */
function setAutoRestoreMs(guildId, ms) {
  const g = guildData(guildId);
  g.autoRestoreMs = ms;
  save();
}

/**
 * Enregistre une restauration de rôles à faire plus tard (voir
 * utils/antiNuke.js — vérifiée périodiquement, survit à un redémarrage
 * puisque c'est persisté comme le reste de la config anti-nuke).
 * @param {string} guildId
 * @param {string} userId
 * @param {string[]} roleIds
 * @param {number} restoreAt timestamp ms
 */
function addPendingRestore(guildId, userId, roleIds, restoreAt) {
  const g = guildData(guildId);
  g.pendingRestores.push({ userId, roleIds, restoreAt });
  save();
}

/**
 * @returns {Array<{ guildId: string, userId: string, roleIds: string[], restoreAt: number }>}
 *   toutes les restaurations en attente, tous serveurs confondus
 */
function getAllPendingRestores() {
  const data = load();
  const all = [];
  for (const guildId of Object.keys(data)) {
    for (const entry of guildData(guildId).pendingRestores) {
      all.push({ guildId, ...entry });
    }
  }
  return all;
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {number} restoreAt
 */
function removePendingRestore(guildId, userId, restoreAt) {
  const g = guildData(guildId);
  g.pendingRestores = g.pendingRestores.filter((r) => !(r.userId === userId && r.restoreAt === restoreAt));
  save();
}

/**
 * @param {string} guildId
 * @returns {number} âge minimum d'un compte (ms) pour rejoindre sans être
 *   expulsé automatiquement — 0 = désactivé (voir `creation`)
 */
function getMinAccountAgeMs(guildId) {
  return guildData(guildId).minAccountAgeMs || 0;
}

/**
 * @param {string} guildId
 * @param {number} ms
 */
function setMinAccountAgeMs(guildId, ms) {
  const g = guildData(guildId);
  g.minAccountAgeMs = ms;
  save();
}

/**
 * @param {string} guildId
 * @returns {string|null} rôle pingé sur une alerte anti-raid (voir `pingraid`)
 */
function getPingRaidRoleId(guildId) {
  return guildData(guildId).pingRaidRoleId || null;
}

/**
 * @param {string} guildId
 * @param {string|null} roleId
 */
function setPingRaidRoleId(guildId, roleId) {
  const g = guildData(guildId);
  g.pingRaidRoleId = roleId;
  save();
}

/**
 * @param {string} guildId
 * @returns {"derank"|"kick"|"ban"|"mute"} sanction appliquée par défaut
 *   quand un module anti-nuke se déclenche (voir `punition`, utils/antiNuke.js)
 */
function getPunition(guildId) {
  return guildData(guildId).punition || "derank";
}

/**
 * @param {string} guildId
 * @param {"derank"|"kick"|"ban"|"mute"} type
 */
function setPunition(guildId, type) {
  const g = guildData(guildId);
  g.punition = type;
  save();
}

/**
 * Valeurs brutes d'un serveur, utilisé par utils/configChannel.js pour
 * sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || DEFAULT_GUILD_DATA();
}

/**
 * Recharge la config anti-nuke d'un serveur depuis une source externe (voir
 * utils/configChannel.js — la config sauvegardée dans un salon Discord
 * dédié, qui survit aux redéploiements Railway contrairement au disque
 * local).
 * @param {string} guildId
 * @param {object} remoteData
 */
function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = { ...data[guildId], ...remoteData };
  save();
}

module.exports = {
  isEnabled,
  setEnabled,
  getOwners,
  addOwner,
  removeOwner,
  isOwner,
  isBotOwner,
  getBotOwnerIds,
  getWhitelist,
  getWhitelistEntry,
  addToWhitelist,
  removeFromWhitelist,
  isWhitelisted,
  isWhitelistedFor,
  getRoleBypass,
  setRoleBypass,
  getCategoryBypass,
  setCategoryBypass,
  getModuleOverride,
  getAllModuleOverrides,
  setModuleOverride,
  getAutoRestoreMs,
  setAutoRestoreMs,
  addPendingRestore,
  getAllPendingRestores,
  removePendingRestore,
  getMinAccountAgeMs,
  setMinAccountAgeMs,
  getPingRaidRoleId,
  setPingRaidRoleId,
  getPunition,
  setPunition,
  getRawGuildData,
  hydrateFromRemote,
};
