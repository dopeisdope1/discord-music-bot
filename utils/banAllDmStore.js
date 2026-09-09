const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Message envoyé en DM à chaque membre AVANT de le bannir via &banall — texte
// libre choisi par qui a lancé la commande (typiquement pour pointer vers un
// nouveau serveur), stocké par serveur. Aucun message par défaut : tant que
// rien n'est configuré, &banall ne DM personne (voir "&banall message").
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "banAllDm.json");

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
    console.error("[banAllDmStore] échec de la sauvegarde :", err);
  }
}

const getDmMessage = (guildId) => load()[guildId] || null;

function setDmMessage(guildId, text) {
  const data = load();
  if (text) data[guildId] = text;
  else delete data[guildId];
  save();
}

module.exports = { getDmMessage, setDmMessage };
