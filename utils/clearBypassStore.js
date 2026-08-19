const fs = require("fs");
const path = require("path");

// Membres dispensés du quota des déclencheurs "uo clear" & consorts (voir
// utils/selfClear.js). Stocké dans DATA_DIR, monté sur un Volume Railway en
// production, donc conservé d'un redéploiement à l'autre.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "clearBypass.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[clearBypassStore] échec de la sauvegarde :", err);
  }
}

/**
 * Propriétaires du bot, lus depuis BOT_OWNER_IDS. Une variable d'env survit à
 * tout, y compris à la perte du fichier ci-dessus : le propriétaire ne peut
 * donc jamais se retrouver lui-même bloqué par le quota.
 */
function ownerIds() {
  return (process.env.BOT_OWNER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const isOwner = (userId) => ownerIds().includes(userId);

/** Dispensé de quota : propriétaire du bot, ou ajouté manuellement. */
function isExempt(userId) {
  return isOwner(userId) || load().includes(userId);
}

/** @returns {boolean} false si la personne y était déjà. */
function add(userId) {
  const list = load();
  if (list.includes(userId)) return false;
  list.push(userId);
  save();
  return true;
}

/** @returns {boolean} false si la personne n'y était pas. */
function remove(userId) {
  const list = load();
  const index = list.indexOf(userId);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

const list = () => [...load()];

module.exports = { isExempt, isOwner, add, remove, list, ownerIds };
