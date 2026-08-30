const fs = require("fs");
const path = require("path");

// Configuration de l'anti-nuke — désactivé par défaut, par serveur, comme
// utils/automod/antiSpam.js : rien ne se déclenche tant que personne ne
// l'active explicitement.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "guard.json");

const PUNISHMENTS = ["timeout", "kick", "ban"];
const DEFAULT_CONFIG = {
  enabled: false,
  // Timeout par défaut : la sanction la moins destructrice — configurable
  // vers "kick"/"ban" si besoin d'une réponse plus dure.
  punishment: "timeout",
  punishmentDurationMs: 10 * 60 * 1000,
};

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

module.exports = { getConfig, setEnabled, setPunishment, PUNISHMENTS };
