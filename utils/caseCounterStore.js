const fs = require("fs");
const path = require("path");

// Compteur de "case" séquentiel par serveur, pour utils/moderationHistoryStore.js.
// Un numéro n'est jamais réattribué : même si l'entrée qui le portait est
// supprimée ou finit purgée (MAX_ENTRIES), le compteur ne recule jamais.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "caseCounters.json");

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
    console.error("[caseCounterStore] échec de la sauvegarde :", err);
  }
}

/** @returns {number} le dernier numéro attribué sur ce serveur (0 si aucun). */
function getLastCaseNumber(guildId) {
  return load()[guildId] || 0;
}

/** @returns {number} le nouveau numéro, déjà persisté. */
function nextCaseNumber(guildId) {
  const data = load();
  const next = (data[guildId] || 0) + 1;
  data[guildId] = next;
  save();
  return next;
}

/**
 * Ne fait avancer le compteur que si `n` est plus grand que ce qui est déjà
 * connu — utilisé par la migration rétroactive de moderationHistoryStore.js,
 * qui numérote les anciennes entrées dans l'ordre chronologique sans jamais
 * faire reculer un compteur déjà entamé par de nouvelles entrées.
 */
function ensureAtLeast(guildId, n) {
  const data = load();
  if ((data[guildId] || 0) >= n) return;
  data[guildId] = n;
  save();
}

module.exports = { getLastCaseNumber, nextCaseNumber, ensureAtLeast };
