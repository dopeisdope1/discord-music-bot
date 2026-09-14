const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("../jsonFile");

// Configuration de l'anti-nuke — désactivé par défaut, par serveur, comme
// utils/automod/antiSpam.js : rien ne se déclenche tant que personne ne
// l'active explicitement.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "guard.json");

// "derank" = retire tous les rôles de l'intrus (la sanction la plus douce,
// réversible) ; timeout/kick/ban ensuite. La sanction globale `punishment`
// s'applique par défaut, MAIS chaque guard peut avoir la sienne via
// `punishmentPerGuard` (voir getGuardPunishment) — comme les "sanctions par
// module" de la capture.
const PUNISHMENTS = ["derank", "timeout", "kick", "ban"];
const DEFAULT_CONFIG = {
  enabled: false,
  // Timeout par défaut : configurable vers derank/kick/ban.
  punishment: "timeout",
  punishmentDurationMs: 10 * 60 * 1000,
  // Sanction PROPRE à un guard précis (clé -> "derank"|"timeout"|"kick"|"ban").
  // Absent = ce guard utilise la sanction globale `punishment`.
  punishmentPerGuard: {},
  // Guards individuellement désactivés (clés de utils/guard/definitions.js,
  // + "antieveryone"/"antijoin" qui ne sont pas dans DEFINITIONS) — le
  // panel permet de couper un guard précis sans tout désactiver.
  disabledGuards: [],
  // Rôle pingé (en plus du log habituel) à chaque déclenchement d'un guard —
  // "&antinuke ping @rôle" / "off". null = pas de ping, comportement d'avant.
  pingRoleId: null,
  // Âge minimum du compte pour pouvoir rejoindre sans être sanctionné —
  // "&antinuke creationlimit <durée>". 0 = désactivé (comportement d'avant).
  creationLimitMs: 0,
  // Anti-Fast est volontairement indépendant de l'interrupteur anti-nuke
  // général. `creationLimitMs` reste conservé comme champ de compatibilité
  // avec les anciennes configurations et commandes.
  antiFastEnabled: false,
  antiFastMinAgeDays: 0,
  // "&antinuke autolockdown on/off" — au lieu de simplement ignorer les
  // sanctions une fois le plafond atteint (voir utils/guard/engine.js,
  // MAX_PUNISHMENTS_PER_MINUTE), verrouille tout le serveur une fois :
  // le signal qu'un vrai raid est en cours, pas juste un guard isolé.
  // Désactivé par défaut (action drastique, opt-in explicite).
  autoLockdownOnCap: false,
};

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
    console.error("[guard/config] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { ...DEFAULT_CONFIG };
  const entry = data[guildId];
  if (typeof entry.enabled !== "boolean") entry.enabled = DEFAULT_CONFIG.enabled;
  if (!PUNISHMENTS.includes(entry.punishment)) entry.punishment = DEFAULT_CONFIG.punishment;
  if (typeof entry.punishmentDurationMs !== "number") entry.punishmentDurationMs = DEFAULT_CONFIG.punishmentDurationMs;
  if (!Array.isArray(entry.disabledGuards)) entry.disabledGuards = [];
  if (typeof entry.pingRoleId !== "string") entry.pingRoleId = null;
  if (typeof entry.creationLimitMs !== "number") entry.creationLimitMs = 0;
  if (typeof entry.antiFastMinAgeDays !== "number" || !Number.isInteger(entry.antiFastMinAgeDays) || entry.antiFastMinAgeDays < 0) {
    entry.antiFastMinAgeDays = Math.max(0, Math.ceil(entry.creationLimitMs / 86400000));
  }
  if (typeof entry.antiFastEnabled !== "boolean") {
    // Migration sûre : une ancienne limite configurée exprimait clairement
    // l'intention d'activer cette protection. Elle ne devient plus dépendante
    // de l'anti-nuke général après migration.
    entry.antiFastEnabled = entry.creationLimitMs > 0;
  }
  if (typeof entry.autoLockdownOnCap !== "boolean") entry.autoLockdownOnCap = false;
  if (!entry.punishmentPerGuard || typeof entry.punishmentPerGuard !== "object") entry.punishmentPerGuard = {};
  return entry;
}

/** @returns {{ enabled: boolean, punishment: "timeout"|"kick"|"ban", punishmentDurationMs: number }} */
function getConfig(guildId) {
  return { ...guildEntry(guildId) };
}

function setEnabled(guildId, enabled) {
  guildEntry(guildId).enabled = enabled;
  save();
}

/** @param {"timeout"|"kick"|"ban"} punishment */
function setPunishment(guildId, punishment) {
  if (!PUNISHMENTS.includes(punishment)) return false;
  guildEntry(guildId).punishment = punishment;
  save();
  return true;
}

/** Vrai si le guard `key` doit s'exécuter. Anti-Fast est une exception
 * indépendante ; les autres guards exigent l'anti-nuke général. */
function isGuardEnabled(guildId, key) {
  const entry = guildEntry(guildId);
  if (key === "creationlimit" || key === "antifast") return entry.antiFastEnabled;
  return entry.enabled && !entry.disabledGuards.includes(key);
}

/** @returns {boolean} nouvel état (true = désormais activé) */
/**
 * Règle un guard à une valeur EXPLICITE, contrairement à toggleGuard qui
 * bascule : "&antibot on" tapé deux fois doit laisser le guard actif, pas le
 * rallumer puis l'éteindre.
 * @returns {boolean} true si l'état a changé
 */
function setGuardEnabled(guildId, key, enabled) {
  const entry = guildEntry(guildId);
  if (key === "creationlimit" || key === "antifast") {
    const wasEnabled = entry.antiFastEnabled;
    if (wasEnabled === enabled) return false;
    entry.antiFastEnabled = Boolean(enabled);
    save();
    return true;
  }
  const wasEnabled = !entry.disabledGuards.includes(key);
  if (wasEnabled === enabled) return false;
  entry.disabledGuards = enabled ? entry.disabledGuards.filter((k) => k !== key) : [...entry.disabledGuards, key];
  save();
  return true;
}

function toggleGuard(guildId, key) {
  const entry = guildEntry(guildId);
  const disabled = entry.disabledGuards.includes(key);
  entry.disabledGuards = disabled ? entry.disabledGuards.filter((k) => k !== key) : [...entry.disabledGuards, key];
  save();
  return disabled;
}

/** @param {string|null} roleId null pour désactiver le ping. */
function setPingRole(guildId, roleId) {
  guildEntry(guildId).pingRoleId = roleId || null;
  save();
}

/** @param {number} ms 0 pour désactiver. */
function setCreationLimit(guildId, ms) {
  const entry = guildEntry(guildId);
  entry.creationLimitMs = Math.max(0, ms || 0);
  entry.antiFastMinAgeDays = Math.max(0, Math.ceil(entry.creationLimitMs / 86400000));
  entry.antiFastEnabled = entry.creationLimitMs > 0;
  save();
}

function setAntiFastEnabled(guildId, enabled) {
  guildEntry(guildId).antiFastEnabled = Boolean(enabled);
  save();
}

/** @param {number} days entier positif ; 0 retire le seuil (le toggle reste séparé) */
function setAntiFastMinAgeDays(guildId, days) {
  const value = Number.isInteger(days) ? Math.max(0, days) : 0;
  const entry = guildEntry(guildId);
  entry.antiFastMinAgeDays = value;
  // Compatibilité avec `creationlimit` et les configurations précédentes.
  entry.creationLimitMs = value * 86400000;
  save();
}

function setAutoLockdown(guildId, enabled) {
  guildEntry(guildId).autoLockdownOnCap = enabled;
  save();
}

/**
 * Sanction EFFECTIVE d'un guard : sa sanction propre (punishmentPerGuard) si
 * définie, sinon la sanction globale du serveur. C'est ce que le moteur
 * applique (voir utils/guard/engine.js).
 * @returns {"derank"|"timeout"|"kick"|"ban"}
 */
function getGuardPunishment(guildId, key) {
  const entry = guildEntry(guildId);
  const propre = entry.punishmentPerGuard[key];
  return PUNISHMENTS.includes(propre) ? propre : entry.punishment;
}

/**
 * Règle la sanction propre d'un guard. Passer null/undefined (ou la même
 * valeur que la sanction globale) le remet sur "sanction globale".
 * @returns {boolean} true si accepté
 */
function setGuardPunishment(guildId, key, punishment) {
  if (punishment != null && !PUNISHMENTS.includes(punishment)) return false;
  const entry = guildEntry(guildId);
  if (punishment == null) delete entry.punishmentPerGuard[key];
  else entry.punishmentPerGuard[key] = punishment;
  save();
  return true;
}

module.exports = {
  getConfig,
  setEnabled,
  setPunishment,
  isGuardEnabled,
  toggleGuard,
  setGuardEnabled,
  setPingRole,
  setCreationLimit,
  setAntiFastEnabled,
  setAntiFastMinAgeDays,
  setAutoLockdown,
  getGuardPunishment,
  setGuardPunishment,
  PUNISHMENTS,
};
