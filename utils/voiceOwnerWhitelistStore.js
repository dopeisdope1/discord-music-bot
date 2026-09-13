const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// "=wl"/"=unwl" (utils/serverAdminCommands.js) : liste PERSISTANTE de
// membres "toujours autorisés" par propriétaire de salon vocal temporaire —
// distincte de "&voc add" (utils/voiceChannels.js), dont l'overwrite ne
// dure que le temps du salon COURANT et disparaît quand le salon est
// supprimé. Cette liste, elle, est appliquée automatiquement à CHAQUE
// nouveau salon créé par ce propriétaire (voir index.js, hook de création
// de salon temporaire, juste après registerChannel).
// { [guildId]: { [ownerId]: string[] } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "voiceOwnerWhitelist.json");

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
    console.error("[voiceOwnerWhitelistStore] échec de la sauvegarde :", err);
  }
}

function getList(guildId, ownerId) {
  return [...(load()[guildId]?.[ownerId] || [])];
}

/** @returns {boolean} true si désormais présent, false si déjà présent (rien à faire). */
function add(guildId, ownerId, memberId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][ownerId]) data[guildId][ownerId] = [];
  const liste = data[guildId][ownerId];
  if (liste.includes(memberId)) return false;
  liste.push(memberId);
  save();
  return true;
}

/** @returns {boolean} true si retiré, false si n'y était pas. */
function remove(guildId, ownerId, memberId) {
  const data = load();
  const liste = data[guildId]?.[ownerId];
  if (!liste || !liste.includes(memberId)) return false;
  data[guildId][ownerId] = liste.filter((id) => id !== memberId);
  save();
  return true;
}

module.exports = { getList, add, remove };
