const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Confessions anonymes ("!!confess", voir utils/confessions.js).
// { [guildId]: { channelId: string|null, setupAuthorId: string|null,
//                pending: {id, texte, anonyme, authorId, authorTag}[],
//                nextId: number } }
//
// `setupAuthorId` : la personne qui a lancé "!!confess setup" — SEULE à
// pouvoir gérer les confessions en attente (demande explicite, remplace la
// permission "server.confessions.manage" pour cet usage précis ; cette
// permission continue de régir qui peut ÉCRIRE dans le salon, voir
// utils/confessions.js::appliquerGardeSalon).
//
// Aucun MP n'est envoyé par le système (demande explicite) : authorId/
// authorTag restent connus en interne (pour une éventuelle modération) mais
// ne servent plus à contacter qui que ce soit.
//
// `pending` (contrairement aux Map en mémoire du reste du fichier) est
// persisté : une confession anonyme envoyée par un membre ne doit pas
// disparaître si le bot redémarre avant que quelqu'un ne la traite.
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
  if (entry.setupAuthorId === undefined) entry.setupAuthorId = null;
  if (!Array.isArray(entry.pending)) entry.pending = [];
  if (!Number.isInteger(entry.nextId)) entry.nextId = 1;
  return entry;
}

function getConfig(guildId) {
  const { channelId, setupAuthorId } = guildEntry(guildId);
  return { channelId, setupAuthorId };
}

/** `authorId` devient LE gestionnaire de ce panneau (voir utils/confessions.js) — écrase le précédent si "!!confess setup" est relancé. */
function setChannel(guildId, channelId, authorId) {
  const entry = guildEntry(guildId);
  entry.channelId = channelId;
  entry.setupAuthorId = authorId;
  save();
}

/**
 * Enregistre une confession en attente de publication manuelle — jamais
 * publiée automatiquement (voir utils/confessions.js). `authorId`/`authorTag`
 * restent connus en interne (pour une éventuelle modération) mais ne
 * doivent JAMAIS être affichés dans l'interface de gestion, ni servir à
 * contacter qui que ce soit par MP.
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
  addPending,
  getPending,
  getPendingById,
  removePending,
};
