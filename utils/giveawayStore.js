const fs = require("fs");
const path = require("path");

// Giveaways : persistés (contrairement aux sondages, une durée de giveaway
// dépasse souvent la durée de vie d'un process — doit survivre à un
// redémarrage/redéploiement).
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
 * @param {object} data
 * @param {string} data.messageId
 * @param {string} data.guildId
 * @param {string} data.channelId
 * @param {string} data.prize
 * @param {number} data.endsAt timestamp ms
 * @param {string} data.hostId
 * @param {number} [data.winnersCount] nombre de gagnants à tirer (1 par défaut)
 * @param {string|null} [data.requiredRoleId] rôle obligatoire pour participer
 */
function create(data) {
  load()[data.messageId] = { ...data, participants: [], winnerIds: [], winnerId: null, ended: false };
  save();
}

function get(messageId) {
  return load()[messageId] || null;
}

/** @returns {boolean} false si déjà participant (retiré), true si ajouté. */
function toggleParticipant(messageId, userId) {
  const entry = load()[messageId];
  if (!entry) return null;
  const index = entry.participants.indexOf(userId);
  if (index === -1) {
    entry.participants.push(userId);
    save();
    return true;
  }
  entry.participants.splice(index, 1);
  save();
  return false;
}

/**
 * `winnerIds` est la liste complète des gagnants ; `winnerId` reste écrit avec
 * le premier d'entre eux pour que les giveaways enregistrés AVANT le
 * multi-gagnant restent lisibles sans migration du fichier.
 */
function markEnded(messageId, winnerIds) {
  const entry = load()[messageId];
  if (!entry) return;
  const list = Array.isArray(winnerIds) ? winnerIds : winnerIds ? [winnerIds] : [];
  entry.ended = true;
  entry.winnerIds = list;
  entry.winnerId = list[0] || null;
  save();
}

/** @returns {object[]} giveaways non terminés dont endsAt est dépassé. */
function getExpiredActive() {
  const now = Date.now();
  return Object.values(load()).filter((g) => !g.ended && g.endsAt <= now);
}

/** Dernier giveaway (terminé ou non) posté dans ce salon, pour &giveaway reroll sans ID. */
function getLatestInChannel(channelId) {
  const all = Object.values(load()).filter((g) => g.channelId === channelId);
  return all.sort((a, b) => b.endsAt - a.endsAt)[0] || null;
}

/** Tous les giveaways (terminés ou non) d'un serveur — panel > Communauté > Giveaways. */
function listForGuild(guildId) {
  return Object.values(load()).filter((g) => g.guildId === guildId);
}

module.exports = { create, get, toggleParticipant, markEnded, getExpiredActive, getLatestInChannel, listForGuild };
