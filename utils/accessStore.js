const fs = require("fs");
const path = require("path");

// Autorisations accordées à la main par le propriétaire, par "portée" :
//   clear  -> dispense du quota des déclencheurs "uo clear" & consorts
//   salon  -> accès à &renew/&hide/&unhide/&lock/&unlock
// Deux portées distinctes volontairement : laisser quelqu'un vider ses
// propres messages n'implique pas de le laisser supprimer un salon.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "access.json");

// Ancien fichier, qui ne contenait qu'un tableau d'IDs pour les clear. Repris
// tel quel au premier chargement pour ne pas perdre les dispenses déjà
// accordées en production.
const LEGACY_FILE = path.join(DATA_DIR, "clearBypass.json");

const SCOPES = ["clear", "salon"];

let cache = null;

function readLegacyClear() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function load() {
  if (cache) return cache;

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    parsed = null;
  }

  cache = {};
  for (const scope of SCOPES) {
    cache[scope] = Array.isArray(parsed?.[scope]) ? parsed[scope] : [];
  }
  if (!parsed) cache.clear = readLegacyClear();

  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[accessStore] échec de la sauvegarde :", err);
  }
}

/**
 * Propriétaires du bot, lus depuis BOT_OWNER_IDS. Une variable d'env survit à
 * tout, y compris à la perte du fichier ci-dessus : le propriétaire ne peut
 * donc jamais se retrouver lui-même bloqué.
 */
function ownerIds() {
  return (process.env.BOT_OWNER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const isOwner = (userId) => ownerIds().includes(userId);

/** Autorisé sur cette portée : propriétaire du bot, ou ajouté à la main. */
function isAllowed(scope, userId) {
  return isOwner(userId) || (load()[scope] || []).includes(userId);
}

/** @returns {boolean} false si la personne y était déjà. */
function add(scope, userId) {
  const list = load()[scope];
  if (!list || list.includes(userId)) return false;
  list.push(userId);
  save();
  return true;
}

/** @returns {boolean} false si la personne n'y était pas. */
function remove(scope, userId) {
  const list = load()[scope];
  const index = list ? list.indexOf(userId) : -1;
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

const list = (scope) => [...(load()[scope] || [])];

module.exports = { isAllowed, isOwner, add, remove, list, ownerIds, SCOPES };
