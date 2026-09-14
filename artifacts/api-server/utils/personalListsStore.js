const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Listes personnelles associées à certaines protections de !!panel (voir
// utils/personalProtectionStore.js) : Anti-Mention Perso a une LISTE de
// membres surveillés, Mute Bot a
// UNE seule cible désignée. Fichier séparé de personalProtectionStore.js —
// ce dernier ne stocke que des booléens (le simple "activé/désactivé"), pas
// le contenu des listes.
// { [guildId]: { [userId]: { antiMentionPerso: string[],
//                             muteBotTarget: string|null } } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "personalLists.json");

const CLES_LISTE = ["antiMentionPerso"];

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

/** Variante de findWatchers pour Mute Bot (muteBotTarget n'est pas une liste). */
function findMuteBotProtectors(guildId, targetId) {
  const data = load()[guildId] || {};
  return Object.entries(data)
    .filter(([, e]) => e.muteBotTarget === targetId)
    .map(([userId]) => userId);
}

module.exports = { getList, toggleInList, getTarget, setTarget, findMuteBotProtectors };
