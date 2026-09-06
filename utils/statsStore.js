const fs = require("fs");
const path = require("path");

// Compteurs journaliers par serveur (messages/arrivées/départs), pour
// &stats history. Écriture VOLONTAIREMENT différée (flush() périodique
// depuis index.js) plutôt qu'à chaque appel de record() : contrairement aux
// actions de modération (rares), un message arrive potentiellement des
// dizaines de fois par seconde sur un serveur actif — écrire sur disque à
// cette fréquence serait le seul vrai goulot d'étranglement du bot.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "stats.json");

// Au-delà, les jours les plus anciens sont oubliés (par serveur) — largement
// au-delà de ce qu'un `&stats history` réaliste demande à la fois.
const MAX_DAYS_KEPT = 90;

let cache = null;
let dirty = false;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

/** À appeler périodiquement (voir index.js) — no-op si rien n'a changé depuis le dernier flush. */
function flush() {
  if (!dirty) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
    dirty = false;
  } catch (err) {
    console.error("[statsStore] échec de la sauvegarde :", err);
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function dayEntry(guildId, date) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][date]) data[guildId][date] = { messages: 0, joins: 0, leaves: 0 };
  const days = Object.keys(data[guildId]);
  if (days.length > MAX_DAYS_KEPT) {
    for (const old of days.sort().slice(0, days.length - MAX_DAYS_KEPT)) delete data[guildId][old];
  }
  return data[guildId][date];
}

/** @param {"messages"|"joins"|"leaves"} metric */
function record(guildId, metric) {
  dayEntry(guildId, todayKey())[metric] += 1;
  dirty = true;
}

/** @returns {{date:string, messages:number, joins:number, leaves:number}[]} les `days` derniers jours, du plus ancien au plus récent, aujourd'hui inclus. */
function getRange(guildId, days = 7) {
  const guildData = load()[guildId] || {};
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, messages: 0, joins: 0, leaves: 0, ...guildData[key] });
  }
  return result;
}

module.exports = { record, getRange, flush };
