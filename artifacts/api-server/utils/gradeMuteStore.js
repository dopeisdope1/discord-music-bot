const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Mute bot gradé ("&bmute") — voir utils/gradeMuteCommands.js. Chaque entrée
// retient à quel INDEX de l'échelle de grades (utils/rankLadderStore.js) le
// mute a été posé : le lever exige un grade au moins égal, jamais inférieur.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "gradeMute.json");

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
    console.error("[gradeMuteStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  return data[guildId];
}

function getMute(guildId, userId) {
  return guildEntry(guildId)[userId] || null;
}

/** @param {{ gradeIndex: number, moderatorId: string, reason?: string }} info */
function setMute(guildId, userId, info) {
  guildEntry(guildId)[userId] = {
    gradeIndex: info.gradeIndex,
    moderatorId: info.moderatorId,
    reason: info.reason || null,
    at: Date.now(),
  };
  save();
}

/** @returns {object|null} l'entrée retirée, ou null si elle n'existait pas. */
function removeMute(guildId, userId) {
  const entry = guildEntry(guildId);
  const removed = entry[userId] || null;
  if (removed) {
    delete entry[userId];
    save();
  }
  return removed;
}

/** @returns {{ userId: string, gradeIndex: number, moderatorId: string, reason: string|null, at: number }[]} */
function list(guildId) {
  return Object.entries(guildEntry(guildId)).map(([userId, info]) => ({ userId, ...info }));
}

module.exports = { getMute, setMute, removeMute, list };
