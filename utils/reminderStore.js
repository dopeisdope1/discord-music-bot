const fs = require("fs");
const path = require("path");

// DATA_DIR configurable via DATA_DIR — voir les autres stores (ex:
// utils/tempBanStore.js) pour l'explication complète. Synchronisé via le
// salon de config Discord (voir utils/configChannel.js) : un rappel peut
// couvrir plusieurs heures/jours et doit survivre à un redéploiement Railway.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "reminders.json");

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
    console.error("[reminderStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @param {{ userId: string, channelId: string, text: string, dueAt: number }} info
 * @returns {number} id du rappel créé (local à ce serveur)
 */
function addReminder(guildId, { userId, channelId, text, dueAt }) {
  const data = load();
  if (!data[guildId]) data[guildId] = [];
  const id = data[guildId].reduce((max, r) => Math.max(max, r.id), 0) + 1;
  data[guildId].push({ id, userId, channelId, text, dueAt });
  save();
  return id;
}

function removeReminder(guildId, id) {
  const data = load();
  if (!data[guildId]) return;
  data[guildId] = data[guildId].filter((r) => r.id !== id);
  save();
}

/**
 * Aplati tous les rappels de tous les serveurs — utilisé par le
 * vérificateur périodique (voir gestion.js), qui n'a pas besoin de connaître
 * la liste des guildes à l'avance.
 * @returns {Array<{ guildId: string, id: number, userId: string, channelId: string, text: string, dueAt: number }>}
 */
function getAllReminders() {
  const data = load();
  const result = [];
  for (const guildId of Object.keys(data)) {
    for (const reminder of data[guildId]) result.push({ guildId, ...reminder });
  }
  return result;
}

function getRawGuildData(guildId) {
  return load()[guildId] || [];
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = { addReminder, removeReminder, getAllReminders, getRawGuildData, hydrateFromRemote };
