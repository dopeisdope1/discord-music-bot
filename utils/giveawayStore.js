const fs = require("fs");
const path = require("path");

// Synchronisé via le salon de config Discord (voir utils/configChannel.js) :
// un giveaway peut durer plusieurs jours et doit survivre à un redéploiement
// Railway, comme les rappels (utils/reminderStore.js) et les bans temporaires.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "giveaways.json");

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
    console.error("[giveawayStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {string} guildId
 * @param {{ channelId: string, messageId: string, prize: string, winnerCount: number, endAt: number, hostId: string }} info
 * @returns {number} id du giveaway créé (local à ce serveur)
 */
function addGiveaway(guildId, { channelId, messageId, prize, winnerCount, endAt, hostId }) {
  const data = load();
  if (!data[guildId]) data[guildId] = [];
  const id = data[guildId].reduce((max, g) => Math.max(max, g.id), 0) + 1;
  data[guildId].push({ id, channelId, messageId, prize, winnerCount, endAt, hostId, ended: false });
  save();
  return id;
}

/**
 * @param {string} guildId
 * @param {string|number} idOrMessageId
 */
function getGiveaway(guildId, idOrMessageId) {
  const list = load()[guildId] || [];
  return list.find((g) => String(g.id) === String(idOrMessageId) || g.messageId === String(idOrMessageId)) || null;
}

function getActiveGiveaways(guildId) {
  return (load()[guildId] || []).filter((g) => !g.ended);
}

function markEnded(guildId, id) {
  const data = load();
  const g = (data[guildId] || []).find((x) => x.id === id);
  if (g) g.ended = true;
  save();
}

/**
 * Aplati les giveaways actifs de tous les serveurs — utilisé par le
 * vérificateur périodique (voir gestion.js).
 */
function getAllActiveGiveaways() {
  const data = load();
  const result = [];
  for (const guildId of Object.keys(data)) {
    for (const g of data[guildId]) {
      if (!g.ended) result.push({ guildId, ...g });
    }
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

module.exports = {
  addGiveaway,
  getGiveaway,
  getActiveGiveaways,
  markEnded,
  getAllActiveGiveaways,
  getRawGuildData,
  hydrateFromRemote,
};
