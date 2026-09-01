const fs = require("fs");
const path = require("path");

// Bypass anti-nuke par utilisateur/rôle — délibérément séparé de
// utils/automod/antiSpam.js (protection.whitelist) : exempter quelqu'un du
// timeout anti-flood n'a aucun rapport avec l'exempter de la détection
// anti-nuke, même distinction que côté CrowBot (whitelist antiraid vs
// whitelist vocale, deux systèmes différents).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "guardWhitelist.json");

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
    console.error("[guard/whitelist] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { users: [], roles: [] };
  if (!Array.isArray(data[guildId].users)) data[guildId].users = [];
  if (!Array.isArray(data[guildId].roles)) data[guildId].roles = [];
  return data[guildId];
}

/** @returns {{ users: string[], roles: string[] }} */
function getWhitelist(guildId) {
  const entry = guildEntry(guildId);
  return { users: [...entry.users], roles: [...entry.roles] };
}

/** @param {"users"|"roles"} kind */
function add(guildId, kind, id) {
  const list = guildEntry(guildId)[kind];
  if (list.includes(id)) return false;
  list.push(id);
  save();
  return true;
}

function remove(guildId, kind, id) {
  const list = guildEntry(guildId)[kind];
  const index = list.indexOf(id);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

/** @param {import('discord.js').GuildMember} member */
function isWhitelisted(member) {
  const { users, roles } = getWhitelist(member.guild.id);
  if (users.includes(member.id)) return true;
  return member.roles.cache.some((r) => roles.includes(r.id));
}

/** Vide la whitelist (utilisateurs ET rôles) d'un coup — "&antinuke clearwl". @returns {number} nombre d'entrées retirées. */
function clearAll(guildId) {
  const entry = guildEntry(guildId);
  const count = entry.users.length + entry.roles.length;
  entry.users = [];
  entry.roles = [];
  save();
  return count;
}

module.exports = { getWhitelist, add, remove, isWhitelisted, clearAll };
