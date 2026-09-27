const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Confessions anonymes ("!!confess", voir utils/confessions.js) — flux à
// validation :
// { [guildId]: { channelId: string|null, validationChannelId: string|null,
//                confessions: {
//                  id, authorId, authorTag, texte, anonyme,
//                  status: "attente"|"acceptee"|"refusee",
//                  createdAt, moderatedBy, moderatedAt,
//                  moderationMessageId, publishedMessageId,
//                }[],
//                nextId: number } }
//
// Toutes les confessions (pas seulement celles en attente) restent dans le
// tableau, avec leur statut — "chaque confession doit pouvoir être
// retrouvée grâce à son ID" (demande explicite), pas seulement tant qu'elle
// est en attente.
//
// Qui a le droit de valider vient du système de permissions existant du
// panel (clé "server.confessions.manage", voir utils/permissions/catalog.js
// et utils/confessions.js::PERM_GERER) — jamais un rôle codé en dur ici.
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
  if (entry.validationChannelId === undefined) entry.validationChannelId = null;
  if (!Array.isArray(entry.confessions)) entry.confessions = [];
  if (!Number.isInteger(entry.nextId)) entry.nextId = 1;
  return entry;
}

function getConfig(guildId) {
  const { channelId, validationChannelId } = guildEntry(guildId);
  return { channelId, validationChannelId };
}

function setChannel(guildId, channelId) {
  guildEntry(guildId).channelId = channelId;
  save();
}

/** Salon PRIVÉ où chaque confession arrive comme son propre message, avec Accepter/Refuser. */
function setValidationChannel(guildId, channelId) {
  guildEntry(guildId).validationChannelId = channelId;
  save();
}

/**
 * Enregistre une nouvelle confession, statut "attente" — jamais publiée
 * automatiquement (voir utils/confessions.js). `authorId`/`authorTag`
 * restent visibles du staff (salon de validation, données internes) mais ne
 * doivent JAMAIS apparaître dans la publication PUBLIQUE si `anonyme`.
 * @returns {string} l'identifiant attribué (ex. "016")
 */
function addConfession(guildId, { texte, anonyme, authorId, authorTag }) {
  const entry = guildEntry(guildId);
  const id = String(entry.nextId++).padStart(3, "0");
  entry.confessions.push({
    id,
    authorId,
    authorTag,
    texte,
    anonyme,
    status: "attente",
    createdAt: Date.now(),
    moderatedBy: null,
    moderatedAt: null,
    moderationMessageId: null,
    publishedMessageId: null,
  });
  save();
  return id;
}

function getConfession(guildId, id) {
  return guildEntry(guildId).confessions.find((c) => c.id === id) || null;
}

/** Le message posté dans le salon de validation — retenu pour pouvoir l'éditer après décision, y compris après un redémarrage. */
function setModerationMessageId(guildId, id, messageId) {
  const c = getConfession(guildId, id);
  if (!c) return;
  c.moderationMessageId = messageId;
  save();
}

function setPublishedMessageId(guildId, id, messageId) {
  const c = getConfession(guildId, id);
  if (!c) return;
  c.publishedMessageId = messageId;
  save();
}

/**
 * Bascule ATOMIQUE "attente" -> `status` (acceptee/refusee) : ne fait rien
 * et renvoie `null` si la confession n'existe pas ou n'est plus en attente
 * (déjà traitée par quelqu'un d'autre) — c'est ce qui empêche qu'une même
 * confession soit acceptée ET refusée (demande explicite).
 * @returns {object|null} la confession mise à jour, ou null si déjà traitée/inconnue
 */
function moderer(guildId, id, status, moderatorId) {
  const c = getConfession(guildId, id);
  if (!c || c.status !== "attente") return null;
  c.status = status;
  c.moderatedBy = moderatorId;
  c.moderatedAt = Date.now();
  save();
  return c;
}

module.exports = {
  getConfig,
  setChannel,
  setValidationChannel,
  addConfession,
  getConfession,
  setModerationMessageId,
  setPublishedMessageId,
  moderer,
};
