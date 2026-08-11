const fs = require("fs");
const path = require("path");

// DATA_DIR est configurable via la variable d'env DATA_DIR : sur Railway, le
// disque du container est réinitialisé à chaque redéploiement, donc tout ce
// qui est écrit dans le chemin par défaut (relatif au code) est perdu au
// prochain push. Pointer DATA_DIR vers un Volume Railway monté (persistant,
// lui, entre les redéploiements) rend ce fichier permanent. Voir le README.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "logChannels.json");

// Catégories affichées via `=logs` (bot Sécurité), alignées sur les rubriques
// de `.help`/`=help`. Ce store est partagé entre le bot principal (Musique +
// Modération, qui écrit les logs "moderation"/"salon"/"roles") et le bot
// Sécurité (qui expose le choix des salons via `=logs`, et écrit lui-même
// "securite"/"blacklist") — voir utils/configChannel.js.
const LOG_CATEGORIES = {
  moderation: { key: "moderation", label: "Logs modération", description: "`.clear`, `.ban`, `.unban`" },
  salon: { key: "salon", label: "Logs salon", description: "`.renew`, `.hide`, `.unhide`, `.lock`, `.unlock`" },
  roles: { key: "roles", label: "Logs rôles", description: "`.massrole` + changements manuels de rôle" },
  securite: { key: "securite", label: "Logs sécurité", description: "Alertes anti-nuke (\"antifast\")" },
  blacklist: { key: "blacklist", label: "Logs blacklist", description: "Ajouts/retraits et bannissements automatiques" },
  messages: { key: "messages", label: "Logs messages", description: "Messages supprimés/édités (contenu complet)" },
  embeds: { key: "embeds", label: "Logs embeds", description: "Contenu des embeds perdus lors d'une suppression" },
  vocal: { key: "vocal", label: "Logs vocal", description: "Arrivées/départs/déplacements en salon vocal" },
  joinleave: { key: "joinleave", label: "Logs arrivées/départs", description: "Membres qui rejoignent/quittent le serveur" },
  automod: { key: "automod", label: "Logs AutoMod", description: "Messages bloqués par l'AutoMod natif de Discord" },
};

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
    console.error("[logStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ [category: string]: string }} catégorie -> ID de salon
 */
function getLogChannels(guildId) {
  const data = load();
  return { ...(data[guildId] || {}) };
}

/**
 * @param {string} guildId
 * @param {string} category
 * @returns {string|null}
 */
function getLogChannelId(guildId, category) {
  return getLogChannels(guildId)[category] || null;
}

/**
 * @param {string} guildId
 * @param {string} category
 * @param {string} channelId
 */
function setLogChannel(guildId, category, channelId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][category] = channelId;
  save();
}

/**
 * Valeurs brutes d'un serveur, utilisé par utils/configChannel.js pour
 * sauvegarder/restaurer via Discord.
 * @param {string} guildId
 */
function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

/**
 * Recharge les salons de logs d'un serveur depuis une source externe (voir
 * utils/configChannel.js — la config sauvegardée dans un salon Discord dédié,
 * qui survit aux redéploiements Railway contrairement au disque local).
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
  getLogChannels,
  getLogChannelId,
  setLogChannel,
  getRawGuildData,
  hydrateFromRemote,
  LOG_CATEGORIES,
};
