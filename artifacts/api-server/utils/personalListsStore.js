const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Listes personnelles associées à certaines protections de !!panel (voir
// utils/personalProtectionStore.js) : Anti-Cafard/Fuite Vocale/Anti-Mention
// Perso/Anti-Stalker ont chacune une LISTE de membres surveillés, Mute Bot a
// UNE seule cible désignée. Fichier séparé de personalProtectionStore.js —
// ce dernier ne stocke que des booléens (le simple "activé/désactivé"), pas
// le contenu des listes.
// { [guildId]: { [userId]: { antiCafard: string[], fuiteVocale: string[],
//                             antiMentionPerso: string[], antiStalker: string[],
//                             muteBotTarget: string|null } } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "personalLists.json");

const CLES_LISTE = ["antiCafard", "fuiteVocale", "antiMentionPerso", "antiStalker"];

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
    console.error("[personalListsStore] échec de la sauvegarde :", err);
  }
}

function entree(guildId, userId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = {};
  const e = data[guildId][userId];
  for (const cle of CLES_LISTE) if (!Array.isArray(e[cle])) e[cle] = [];
  if (e.muteBotTarget === undefined) e.muteBotTarget = null;
  return e;
}

function getList(guildId, userId, cle) {
  return [...entree(guildId, userId)[cle]];
}

/** @returns {boolean} true si désormais dans la liste, false si désormais retiré. */
function toggleInList(guildId, userId, cle, id) {
  const e = entree(guildId, userId);
  const present = e[cle].includes(id);
  if (present) e[cle] = e[cle].filter((x) => x !== id);
  else e[cle].push(id);
  save();
  return !present;
}

function getTarget(guildId, userId) {
  return entree(guildId, userId).muteBotTarget;
}

function setTarget(guildId, userId, targetId) {
  entree(guildId, userId).muteBotTarget = targetId || null;
  save();
}

/**
 * Recherche inverse : qui (dans ce serveur) surveille CET utilisateur via
 * `cle` — nécessaire pour Mute Bot (qui protège cette cible démutée ?) et
 * Anti-Stalker (qui a listé cet arrivant ?). O(n) sur les membres ayant une
 * liste dans ce serveur — pas un chemin chaud, jamais appelé par message.
 * @returns {string[]} identifiants des membres qui surveillent `targetId`
 */
function findWatchers(guildId, targetId, cle) {
  const data = load()[guildId] || {};
  return Object.entries(data)
    .filter(([, e]) => Array.isArray(e[cle]) && e[cle].includes(targetId))
    .map(([userId]) => userId);
}

/** Variante de findWatchers pour Mute Bot (muteBotTarget n'est pas une liste). */
function findMuteBotProtectors(guildId, targetId) {
  const data = load()[guildId] || {};
  return Object.entries(data)
    .filter(([, e]) => e.muteBotTarget === targetId)
    .map(([userId]) => userId);
}

module.exports = { getList, toggleInList, getTarget, setTarget, findWatchers, findMuteBotProtectors };
