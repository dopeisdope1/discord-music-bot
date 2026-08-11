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

function guildData(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { enabled: true, owners: [], whitelist: {} };
  // Migration depuis l'ancien format (whitelist: string[] à plat, exemption
  // totale) vers le nouveau (whitelist: { [userId]: string[] modules }) —
  // au premier accès après mise à jour du bot, convertit chaque ancienne
  // entrée en "all" pour ne rien perdre.
  if (Array.isArray(data[guildId].whitelist)) {
    const migrated = {};
    for (const userId of data[guildId].whitelist) migrated[userId] = ["all"];
    data[guildId].whitelist = migrated;
  }
  return data[guildId];
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
 * Valeurs brutes d'un serveur, utilisé par utils/configChannel.js pour
 * sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || { enabled: true, owners: [], whitelist: {} };
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
  getRawGuildData,
  hydrateFromRemote,
};
