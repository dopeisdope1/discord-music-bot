const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// &absence set/reset : un membre se déclare absent (raison facultative), pour
// que le reste du staff sache ne pas compter sur lui — self-service, comme
// "uo clear", jamais une sanction. { [guildId]: { [userId]: { since, reason } } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "absence.json");

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
    console.error("[absenceStore] échec de la sauvegarde :", err);
  }
}

function setAbsent(guildId, userId, reason) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][userId] = { since: new Date().toISOString(), reason: reason || null };
  save();
}

/** @returns {boolean} vrai si la personne était bien marquée absente */
function clearAbsent(guildId, userId) {
  const data = load();
  if (!data[guildId]?.[userId]) return false;
  delete data[guildId][userId];
  if (!Object.keys(data[guildId]).length) delete data[guildId];
  save();
  return true;
}

/** @returns {{since: string, reason: string|null}|null} */
function getAbsence(guildId, userId) {
  return load()[guildId]?.[userId] || null;
}

module.exports = { setAbsent, clearAbsent, getAbsence };
