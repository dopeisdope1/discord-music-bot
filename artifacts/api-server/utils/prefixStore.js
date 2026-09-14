const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// DATA_DIR est configurable via la variable d'env DATA_DIR afin de conserver
// les réglages entre les redéploiements.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "prefixes.json");

// Architecture 4 préfixes de commandes :
//   musicMod = "&" → GESTION (rôles/salons/tickets/giveaways/logs/config…),
//     partagé avec le CrowBot du serveur (voir utils/musicCommands.js)
//   moderation = "-" → MODÉRATION (ban/kick/mute/warn/clear/lockdown…)
//   protection = "!!" → SÉCURITÉ (antinuke/antiraid/automod/whitelist…) +
//     protection PERSONNELLE (utils/personalProtection.js, "!!panel")
//   owner = "=" → VOCAL (mute/deaf/move/… + carte d'accès "=owner")
// Le routage mot→préfixe se fait par catégorie (voir utils/commandRouting.js).
const DEFAULT_PREFIXES = { musicMod: "&", moderation: "-", protection: "!!", owner: "=" };
const PREFIX_LABELS = {
  musicMod: "gestion",
  moderation: "modération",
  protection: "sécurité/protection",
  owner: "vocal/owner",
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
    console.error("[prefixStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @returns {{ musicMod: string, moderation: string, protection: string, owner: string }}
 */
function getPrefixes(guildId) {
  const data = load();
  const { main: _legacyMain, ...configured } = data[guildId] || {};
  return { ...DEFAULT_PREFIXES, ...configured };
}

/**
 * @param {string} guildId
 * @param {"musicMod"|"moderation"|"protection"|"owner"} type
 * @param {string} value
 */
function setPrefix(guildId, type, value) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][type] = value;
  save();
}

/**
 * Prefixes are matched with startsWith by the text dispatchers. Therefore an
 * exact duplicate is not the only collision: "!" shadows "!!", and vice
 * versa, whichever dispatcher runs first. Return all conflicting families so
 * callers can give a useful error instead of silently making commands
 * unreachable.
 */
function prefixConflicts(prefixes) {
  const entries = Object.entries(prefixes).filter(([, value]) => typeof value === "string" && value.length);
  const conflicts = [];
  for (let i = 0; i < entries.length; i++) {
    const [leftKey, leftValue] = entries[i];
    for (let j = i + 1; j < entries.length; j++) {
      const [rightKey, rightValue] = entries[j];
      if (leftValue.startsWith(rightValue) || rightValue.startsWith(leftValue)) {
        conflicts.push({
          leftKey,
          rightKey,
          leftValue,
          rightValue,
          leftLabel: PREFIX_LABELS[leftKey] || leftKey,
          rightLabel: PREFIX_LABELS[rightKey] || rightKey,
        });
      }
    }
  }
  return conflicts;
}

function prefixConflictMessage(conflicts) {
  return conflicts
    .map((conflict) => `\`${conflict.leftValue}\` (${conflict.leftLabel}) et \`${conflict.rightValue}\` (${conflict.rightLabel}) se chevauchent`)
    .join(" ; ");
}

module.exports = { getPrefixes, setPrefix, DEFAULT_PREFIXES, PREFIX_LABELS, prefixConflicts, prefixConflictMessage };
