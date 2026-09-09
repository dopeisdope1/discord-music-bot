const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Autorisations accordées à la main par le propriétaire, par "portée" :
//   clear  -> dispense du quota des déclencheurs "uo clear" & consorts
//   salon  -> accès à &renew/&hide/&unhide/&lock/&unlock
//   sys    -> accès à TOUT (voir &zinki), sauf à la distribution du rang sys
// clear et salon sont distinctes volontairement : laisser quelqu'un vider ses
// propres messages n'implique pas de le laisser supprimer un salon.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "access.json");

// Ancien fichier, qui ne contenait qu'un tableau d'IDs pour les clear. Repris
// tel quel au premier chargement pour ne pas perdre les dispenses déjà
// accordées en production.
const LEGACY_FILE = path.join(DATA_DIR, "clearBypass.json");

const SCOPES = ["clear", "salon", "sys", "banall"];

// Portées que le rang sys n'hérite PAS : elles doivent être accordées une par
// une. "banall" en fait partie — vider un serveur entier est trop lourd de
// conséquences pour être un effet de bord du rang sys.
const NO_SYS_INHERIT = new Set(["owner", "banall"]);

let cache = null;

function readLegacyClear() {
  try {
    const parsed = lireJson(LEGACY_FILE);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function load() {
  if (cache) return cache;

  let parsed = null;
  try {
    parsed = lireJson(DATA_FILE);
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
    ecrireJson(DATA_FILE, cache);
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

const isSys = (userId) => (load().sys || []).includes(userId);

/**
 * Hiérarchie :
 *   propriétaire (BOT_OWNER_IDS) -> tout, sans exception
 *   sys (&zinki)                 -> tout, SAUF les portées "owner"
 *   portée précise               -> uniquement ce qui lui a été accordé
 *
 * Le rang sys ne couvre volontairement pas "owner" : sans ça, un sys pourrait
 * distribuer le rang sys à son tour et l'accès deviendrait irrévocable depuis
 * l'intérieur. Seul le propriétaire, identifié par variable d'environnement,
 * peut en créer.
 */
function isAllowed(scope, userId) {
  if (isOwner(userId)) return true;
  if (scope === "owner") return false;
  if (isSys(userId) && !NO_SYS_INHERIT.has(scope)) return true;
  return (load()[scope] || []).includes(userId);
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

module.exports = { isAllowed, isOwner, isSys, add, remove, list, ownerIds, SCOPES };
