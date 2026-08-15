const fs = require("fs");
const path = require("path");

// Hiérarchie "sys" du bot — PAS par serveur (bot-wide), donc volontairement
// PAS sauvegardée dans le salon "zinki-config" (qui est par serveur, voir
// utils/configChannel.js). "super_sys" est re-seedé à chaque démarrage depuis
// BOT_OWNER_IDS (une variable d'env survit toujours aux redéploiements
// Railway) ; les promotions "sys" faites à l'exécution via `&owner add`,
// elles, ne survivent pas à un redéploiement sans Volume Railway monté sur
// DATA_DIR — acceptable : le pire cas est de refaire `&owner add` une fois.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "botAdmins.json");

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
    console.error("[botAdminsStore] échec de la sauvegarde :", err);
  }
}

function seedOwnersFromEnv() {
  const ids = (process.env.BOT_OWNER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const data = load();
  for (const id of ids) data[id] = "super_sys";
  save();
}

function getTier(userId) {
  return load()[userId] || null;
}

function isSuperSys(userId) {
  return getTier(userId) === "super_sys";
}

function isSysOrAbove(userId) {
  const tier = getTier(userId);
  return tier === "sys" || tier === "super_sys";
}

function add(userId, tier) {
  const data = load();
  data[userId] = tier;
  save();
}

function remove(userId) {
  const data = load();
  delete data[userId];
  save();
}

function list() {
  return Object.entries(load()).map(([userId, tier]) => ({ userId, tier }));
}

module.exports = { seedOwnersFromEnv, getTier, isSuperSys, isSysOrAbove, add, remove, list };
