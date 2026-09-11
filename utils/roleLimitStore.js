const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// &limitrole <rôle> <nombre> : plafonne le nombre de membres pouvant avoir un
// rôle donné (rôle "prestige"/place limitée). Vérifié à l'ajout manuel
// (&addrole) et automatique (&autorole) — pas un verrou Discord natif, un
// garde-fou côté bot uniquement. { [guildId]: { [roleId]: nombre } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "roleLimits.json");

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
    console.error("[roleLimitStore] échec de la sauvegarde :", err);
  }
}

function setLimit(guildId, roleId, max) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][roleId] = max;
  save();
}

function clearLimit(guildId, roleId) {
  const data = load();
  if (!data[guildId]?.[roleId]) return false;
  delete data[guildId][roleId];
  if (!Object.keys(data[guildId]).length) delete data[guildId];
  save();
  return true;
}

/** @returns {number|null} */
function getLimit(guildId, roleId) {
  return load()[guildId]?.[roleId] ?? null;
}

module.exports = { setLimit, clearLimit, getLimit };
