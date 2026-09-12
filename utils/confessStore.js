const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Confessions anonymes ("!!confess", voir utils/confessions.js).
// { [guildId]: { channelId: string|null, managerId: string|null,
//                permRoleId: string|null, notifOptIns: string[],
//                pending: {id, texte, anonyme, authorId, authorTag}[],
//                nextId: number } }
//
// `pending` (contrairement aux Map en mémoire du reste du fichier) est
// persisté : une confession anonyme envoyée par un membre ne doit pas
// disparaître si le bot redémarre avant que le gestionnaire ne la traite.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "confess.json");

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
    console.error("[confessStore] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  const entry = data[guildId];
  if (entry.channelId === undefined) entry.channelId = null;
  if (entry.managerId === undefined) entry.managerId = null;
  if (entry.permRoleId === undefined) entry.permRoleId = null;
  if (!Array.isArray(entry.notifOptIns)) entry.notifOptIns = [];
  if (!Array.isArray(entry.pending)) entry.pending = [];
  if (!Number.isInteger(entry.nextId)) entry.nextId = 1;
  return entry;
}

function getConfig(guildId) {
  const { channelId, managerId, permRoleId, notifOptIns } = guildEntry(guildId);
  return { channelId, managerId, permRoleId, notifOptIns: [...notifOptIns] };
}

function setChannel(guildId, channelId) {
  guildEntry(guildId).channelId = channelId;
  save();
}

/** La personne qui a lancé "!!confess" — seule à pouvoir gérer les confessions en attente (voir utils/confessions.js). */
function setManager(guildId, userId) {
  guildEntry(guildId).managerId = userId;
  save();
}

/** Rôle dispensé du blocage d'écriture dans le salon de confession (en plus du gestionnaire, des administrateurs et du bot). */
function setPermRole(guildId, roleId) {
  guildEntry(guildId).permRoleId = roleId;
  save();
}

/** @returns {boolean} le nouvel état (activé/désactivé), après bascule. */
function toggleNotif(guildId, userId) {
  const entry = guildEntry(guildId);
  const index = entry.notifOptIns.indexOf(userId);
  const actif = index === -1;
  if (actif) entry.notifOptIns.push(userId);
  else entry.notifOptIns.splice(index, 1);
  save();
  return actif;
}

/**
 * Enregistre une confession en attente de publication manuelle par le
 * gestionnaire — jamais publiée automatiquement (voir utils/confessions.js).
 * @returns {string} l'identifiant attribué (ex. "001")
 */
function addPending(guildId, { texte, anonyme, authorId, authorTag }) {
  const entry = guildEntry(guildId);
  const id = String(entry.nextId++).padStart(3, "0");
  entry.pending.push({ id, texte, anonyme, authorId, authorTag });
  save();
  return id;
}

function getPending(guildId) {
  return [...guildEntry(guildId).pending];
}

function getPendingById(guildId, id) {
  return guildEntry(guildId).pending.find((p) => p.id === id) || null;
}

function removePending(guildId, id) {
  const entry = guildEntry(guildId);
  const avant = entry.pending.length;
  entry.pending = entry.pending.filter((p) => p.id !== id);
  if (entry.pending.length !== avant) save();
}

module.exports = {
  getConfig,
  setChannel,
  setManager,
  setPermRole,
  toggleNotif,
  addPending,
  getPending,
  getPendingById,
  removePending,
};
