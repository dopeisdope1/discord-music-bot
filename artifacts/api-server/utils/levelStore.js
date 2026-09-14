const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Système de niveaux/XP par message. La permission "server.levels.manage"
// existe dans le catalogue depuis toujours (utils/permissions/catalog.js)
// mais n'avait jamais eu d'implémentation avant ce chantier — voir
// utils/levels.js pour les commandes et l'écoute des messages.
// { [guildId]: { config: {enabled, xpMin, xpMax, cooldownSeconds,
//                          levelUpChannelId}, users: { [userId]: {xp,
//                          level, lastMessageAt} } } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "levels.json");

// Valeurs par défaut communes à la plupart des bots de niveaux : 15-25 XP
// par message, 60s de cooldown pour empêcher le flood pur XP. Désactivé par
// défaut, comme les autres automods — "&levels on" l'active explicitement.
// levelUpChannelId reste à null tant qu'aucune commande ne le configure
// (périmètre v1 resserré) : l'annonce part alors dans le salon du message.
const DEFAULT_CONFIG = { enabled: false, xpMin: 15, xpMax: 25, cooldownSeconds: 60, levelUpChannelId: null };

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
    console.error("[levelStore] échec de la sauvegarde :", err);
  }
}

function entree(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { config: { ...DEFAULT_CONFIG }, users: {} };
  return data[guildId];
}

function getConfig(guildId) {
  return { ...entree(guildId).config };
}

function setEnabled(guildId, enabled) {
  entree(guildId).config.enabled = Boolean(enabled);
  save();
}

/** XP total nécessaire pour ATTEINDRE le niveau n (n >= 1) — formule progressive standard. */
function xpPourNiveau(n) {
  return 5 * n * n + 50 * n + 100;
}

function getUserData(guildId, userId) {
  const u = entree(guildId).users[userId];
  return u ? { ...u } : { xp: 0, level: 0, lastMessageAt: 0 };
}

/**
 * Ajoute de l'XP à un membre, en respectant le cooldown (anti-flood XP).
 * @returns {{leveledUp: boolean, level: number, xp: number}|null} `null` si
 * le cooldown n'est pas encore écoulé (rien n'est enregistré dans ce cas).
 */
function addXp(guildId, userId, amount, cooldownSeconds, now = Date.now()) {
  const g = entree(guildId);
  if (!g.users[userId]) g.users[userId] = { xp: 0, level: 0, lastMessageAt: 0 };
  const u = g.users[userId];
  if (now - u.lastMessageAt < cooldownSeconds * 1000) return null;
  u.lastMessageAt = now;
  u.xp += amount;
  let leveledUp = false;
  while (u.xp >= xpPourNiveau(u.level + 1)) {
    u.level += 1;
    leveledUp = true;
  }
  save();
  return { leveledUp, level: u.level, xp: u.xp };
}

/** Classement décroissant par XP — pour &leaderboard. */
function getLeaderboard(guildId) {
  const users = entree(guildId).users;
  return Object.entries(users)
    .map(([userId, u]) => ({ userId, xp: u.xp, level: u.level }))
    .sort((a, b) => b.xp - a.xp);
}

module.exports = { DEFAULT_CONFIG, getConfig, setEnabled, xpPourNiveau, getUserData, addXp, getLeaderboard };
