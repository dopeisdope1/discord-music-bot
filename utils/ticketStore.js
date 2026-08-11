const fs = require("fs");
const path = require("path");

// Synchronisé via le salon de config Discord (voir utils/configChannel.js) :
// la catégorie configurée et l'historique des tickets doivent survivre à un
// redéploiement Railway.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "tickets.json");

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
    console.error("[ticketStore] échec de la sauvegarde :", err);
  }
}

function ensureGuild(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { categoryId: null, tickets: [] };
  return data[guildId];
}

function setCategory(guildId, categoryId) {
  const g = ensureGuild(guildId);
  g.categoryId = categoryId;
  save();
}

function getCategory(guildId) {
  return ensureGuild(guildId).categoryId;
}

function hasOpenTicket(guildId, userId) {
  return ensureGuild(guildId).tickets.some((t) => t.userId === userId && t.status === "open");
}

/**
 * @param {string} guildId
 * @param {{ channelId: string, userId: string }} info
 * @returns {number} id du ticket créé (local à ce serveur)
 */
function addTicket(guildId, { channelId, userId }) {
  const g = ensureGuild(guildId);
  const id = g.tickets.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  g.tickets.push({ id, channelId, userId, status: "open", createdAt: Date.now(), closedAt: null });
  save();
  return id;
}

function getTicketByChannel(guildId, channelId) {
  return ensureGuild(guildId).tickets.find((t) => t.channelId === channelId) || null;
}

function closeTicket(guildId, channelId) {
  const g = ensureGuild(guildId);
  const ticket = g.tickets.find((t) => t.channelId === channelId && t.status === "open");
  if (!ticket) return null;
  ticket.status = "closed";
  ticket.closedAt = Date.now();
  save();
  return ticket;
}

function getStats(guildId) {
  const tickets = ensureGuild(guildId).tickets;
  return {
    total: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };
}

function getRawGuildData(guildId) {
  return load()[guildId] || null;
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = {
  setCategory,
  getCategory,
  hasOpenTicket,
  addTicket,
  getTicketByChannel,
  closeTicket,
  getStats,
  getRawGuildData,
  hydrateFromRemote,
};
