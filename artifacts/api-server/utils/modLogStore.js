const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Même logique que prefixStore.js : DATA_DIR pointe vers un stockage persistant
// monté, sans quoi le(s) salon(s) de logs choisi(s) seraient oubliés à
// chaque redéploiement.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "modLog.json");

// Un salon par catégorie plutôt qu'un seul pour tout (section 17-19 du
// cahier des charges) : chaque catégorie peut avoir son propre salon, ou
// partager le même. Étendu (rôles/salons/vocal séparés de "serveur", qui
// ne garde que les réglages généraux) pour suivre les nouvelles commandes/
// permissions ajoutées au fil du bot — sans sur-découper non plus.
//
// "moderation" n'en fait plus partie depuis le départ de la modération vers
// son propre bot (moderation-bot, qui gère désormais ses propres logs de
// modération via son propre utils/modLogStore.js réduit — potentiellement
// le MÊME fichier modLog.json si PERMISSIONS_FILE-like est partagé, mais
// filtré à sa seule clé "moderation" côté ce bot-là, jamais lue/écrite ici).
const CATEGORIES = ["members", "roles", "channels", "voice", "server", "bots", "messages"];
const CATEGORY_LABELS = {
  members: "Membres",
  roles: "Rôles",
  channels: "Salons",
  voice: "Vocal",
  server: "Serveur",
  bots: "Bots",
  messages: "Messages",
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = lireJson(DATA_FILE);
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[modLogStore] échec de la sauvegarde :", err);
  }
}

/**
 * Normalise l'entrée d'un serveur, en reprenant l'ancien format à salon
 * unique ({ channelId }, avant l'introduction des catégories) comme salon
 * "members" par défaut — rétrocompatible sans migration manuelle. Retombait
 * sur "moderation" avant le départ de la modération vers son propre bot ;
 * cette catégorie n'existe plus ici, "members" est la première restante.
 */
function guildEntry(guildId) {
  const data = load();
  const raw = data[guildId];
  if (!raw) return {};
  if (raw.channelId && !raw.categories) {
    // Ancien format : une seule clé channelId. Converti en mémoire, pas
    // réécrit tant que rien n'est modifié (évite un save() au simple chargement).
    return { members: raw.channelId };
  }
  return raw.categories || {};
}

/** @returns {string|null} salon configuré pour une catégorie, ou null. */
function getLogChannelId(guildId, category = "members") {
  return guildEntry(guildId)[category] || null;
}

/** @returns {{[category: string]: string|null}} les 4 catégories, pour l'affichage panel. */
function getAllLogChannels(guildId) {
  const entry = guildEntry(guildId);
  return Object.fromEntries(CATEGORIES.map((c) => [c, entry[c] || null]));
}

/** @param {string|null} channelId null pour désactiver cette catégorie. */
function setLogChannelId(guildId, category, channelId) {
  const data = load();
  const current = getAllLogChannels(guildId);
  current[category] = channelId || null;
  const hasAny = Object.values(current).some(Boolean);
  if (hasAny) data[guildId] = { categories: current };
  else delete data[guildId];
  save();
}

module.exports = { getLogChannelId, getAllLogChannels, setLogChannelId, CATEGORIES, CATEGORY_LABELS };
