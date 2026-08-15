const fs = require("fs");
const path = require("path");

// Override bot-wide (pas par serveur) du niveau/statut activé d'une
// commande, posé via `&change`/`&enable`/`&disable`. Comme botAdminsStore,
// volontairement pas sauvegardé dans "zinki-config" (qui est par serveur).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "commandState.json");

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
    console.error("[commandStateStore] échec de la sauvegarde :", err);
  }
}

function getOverride(commandName) {
  return load()[commandName] || null;
}

function setLevel(commandName, level) {
  const data = load();
  data[commandName] = { ...data[commandName], level, disabled: data[commandName]?.disabled || false };
  save();
}

function setDisabled(commandName, disabled) {
  const data = load();
  data[commandName] = { ...data[commandName], level: data[commandName]?.level || null, disabled };
  save();
}

module.exports = { getOverride, setLevel, setDisabled };
