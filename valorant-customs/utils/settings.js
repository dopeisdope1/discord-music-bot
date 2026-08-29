/**
 * Réglages modifiables en direct depuis le panneau de contrôle.
 *
 * Chaque réglage retombe sur la valeur de config.js (donc du .env) tant qu'il
 * n'a pas été changé dans le panneau : modifier le panneau ne casse jamais une
 * configuration existante, et vider data/settings.json remet tout par défaut.
 */

const fs = require("fs");
const path = require("path");

const config = require("../config");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "settings.json");

// Valeurs par défaut = celles de config.js / .env.
const DEFAULTS = {
  warnMs: config.timings.warnMs,
  promoteMs: config.timings.promoteMs,
  autoPromote: config.behaviour.autoPromote,
  warnAcceptAnyVoice: config.behaviour.warnAcceptAnyVoice,
  logChannelId: config.logChannelId,
  voiceCategoryId: config.voiceCategoryId,
  staffRoleId: config.staffRoleId,
  // true = seuls les propriétaires/gestionnaires peuvent créer une partie.
  restrictCreation: false,
  // Préfixe des commandes, modifiable depuis le panneau.
  prefix: process.env.PREFIX || "+",

  // ---- Automatisations (toutes débrayables depuis le panneau) ----
  // Lance la partie toute seule dès que les deux équipes sont complètes.
  autoStart: true,
  // Au lancement, avertit automatiquement ceux qui ne sont pas en vocal.
  autoWarn: true,
  // Termine la partie si les salons d'équipe restent vides N minutes (0 = jamais).
  autoEndMinutes: 10,

  // ---- Rangs Valorant (voir utils/riot.js) ----
  // Récupération automatique du vrai rang depuis l'API. Sans clé d'API, le bot
  // retombe tout seul sur la saisie manuelle : il n'invente jamais un rang.
  autoRank: true,
  // Clé d'API. Vide = celle du .env (RIOT_API_KEY). Jamais affichée en clair.
  riotApiKey: "",
  // Région par défaut quand l'API ne la renvoie pas : eu, na, ap, kr, latam, br.
  riotRegion: (process.env.RIOT_REGION || "eu").toLowerCase(),
  // Durée de vie du rang en cache, en minutes.
  rankCacheMinutes: 30,

  // ---- Équipes ----
  // Répartition équilibrée par rang au lancement (sinon : ordre d'inscription).
  autoBalance: true,
  // Déplacement automatique des joueurs dans le vocal de leur équipe.
  autoMove: true,
  // Bouton « Prendre la place » quand un joueur est retiré pour absence.
  allowReplacement: true,
  // Partie lancée : avertir un joueur qui quitte le vocal de son équipe.
  autoWarnOnLeave: true,

  // ---- Logs ----
  logsEnabled: true,
  // "all" = tout ; "important" = uniquement partie/absence/erreurs.
  logLevel: "all",

  // ---- Apparence ----
  // Emoji affiché dans le titre du panneau de partie.
  titleEmoji: process.env.VALORANT_EMOJI || "",
  // Emojis de rang personnalisés : { iron: "<:fer:123…>", … }
  rankEmojis: {},
};

let overrides = null;

function load() {
  if (overrides) return overrides;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    overrides = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    overrides = {};
  }
  return overrides;
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(overrides, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (error) {
    console.error("[settings] Sauvegarde impossible :", error.message);
  }
}

/** Valeur courante d'un réglage (surcharge du panneau, sinon config.js). */
function get(key) {
  const stored = load();
  return key in stored ? stored[key] : DEFAULTS[key];
}

function set(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Réglage inconnu : ${key}`);
  load()[key] = value;
  persist();
  return value;
}

/** Inverse un réglage booléen et renvoie sa nouvelle valeur. */
function toggle(key) {
  return set(key, !get(key));
}

/** Remet un réglage à la valeur du .env. */
function reset(key) {
  delete load()[key];
  persist();
  return DEFAULTS[key];
}

const warnSeconds = () => Math.round(get("warnMs") / 1000);
const promoteSeconds = () => Math.round(get("promoteMs") / 1000);

module.exports = { DEFAULTS, get, set, toggle, reset, warnSeconds, promoteSeconds };
