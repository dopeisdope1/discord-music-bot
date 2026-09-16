const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("../jsonFile");

// Bypass anti-lien par membre/rôle, SÉPARÉ de la whitelist anti-spam
// (utils/automod/antiSpam.js) déjà réutilisée par checkMessage — même
// raisonnement que utils/guard/whitelist.js (distinct de l'anti-spam) :
// exempter quelqu'un de l'anti-lien spécifiquement n'a pas à dépendre de
// l'anti-spam, et inversement.
//
// Deux listes indépendantes par serveur :
//   "all"    -> exempte TOUT (invitations Discord et liens quelconques)
//   "invite" -> exempte uniquement les invitations Discord (utile en mode
//               Anti-All pour laisser passer les invitations sans lever
//               l'anti-lien sur le reste)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "antiLinkBypass.json");

const SCOPES = ["all", "invite"];

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
    console.error("[antiLinkBypass] échec de la sauvegarde :", err);
  }
}

function scopeEntry(guildId, scope) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][scope]) data[guildId][scope] = { users: [], roles: [] };
  const entry = data[guildId][scope];
  if (!Array.isArray(entry.users)) entry.users = [];
  if (!Array.isArray(entry.roles)) entry.roles = [];
  return entry;
}

/** @param {"all"|"invite"} scope @returns {{ users: string[], roles: string[] }} */
function getBypass(guildId, scope) {
  const entry = scopeEntry(guildId, scope);
  return { users: [...entry.users], roles: [...entry.roles] };
}

/** @param {"all"|"invite"} scope @param {"users"|"roles"} kind */
function addBypass(guildId, scope, kind, id) {
  const list = scopeEntry(guildId, scope)[kind];
  if (list.includes(id)) return false;
  list.push(id);
  save();
  return true;
}

function removeBypass(guildId, scope, kind, id) {
  const list = scopeEntry(guildId, scope)[kind];
  const index = list.indexOf(id);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {"all"|"invite"} scope
 */
function isBypassed(member, scope) {
  const { users, roles } = getBypass(member.guild.id, scope);
  if (users.includes(member.id)) return true;
  return member.roles.cache.some((r) => roles.includes(r.id));
}

module.exports = { SCOPES, getBypass, addBypass, removeBypass, isBypassed };
