const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Historique de modération centralisé (section 20 du cahier des charges).
// JSON append-only : suffisant à l'échelle d'un serveur Discord (quelques
// milliers d'entrées au plus), pas besoin d'une vraie base — reste cohérent
// avec le reste du dépôt (aucune dépendance nouvelle, voir le plan).
//
// Alimenté par deux voies, sans doublon :
//  - utils/moderation/actions.js pour tout ce que CE bot exécute
//    (modérateur réel : message.author/interaction.user) ;
//  - utils/moderationLog.js pour ce que fait n'importe qui d'autre (CrowBot,
//    un modérateur humain) — voir ce fichier pour l'explication du fix
//    d'attribution qui rend cette séparation nécessaire.
//
// N'est JAMAIS purgé par le nettoyage des accès obsolètes (consigne
// explicite : on retire l'accès, pas les traces).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "moderationHistory.json");

// Borne haute pour ne pas laisser le fichier grossir indéfiniment sur un
// serveur très actif ; largement au-delà de ce qu'une recherche humaine
// consulte jamais.
const MAX_ENTRIES = 20_000;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[moderationHistoryStore] échec de la sauvegarde :", err);
  }
}

/**
 * @param {object} entry
 * @param {string} entry.guildId
 * @param {string} entry.action ex: "ban", "kick", "timeout", "clear"...
 * @param {string} entry.targetId
 * @param {string|null} [entry.targetTag]
 * @param {string} entry.moderatorId ID Discord du VRAI modérateur (jamais le bot lui-même)
 * @param {string|null} [entry.moderatorTag]
 * @param {string|null} [entry.reason]
 * @param {string|null} [entry.channelId] salon où l'action a été lancée
 * @param {"bot"|"audit-log"} entry.source
 * @param {object} [entry.extra] détails spécifiques à l'action (durée, filtre &clear, etc.)
 * @returns {string} l'ID de l'entrée créée
 */
function record(entry) {
  const list = load();
  const id = crypto.randomUUID();
  list.push({
    id,
    createdAt: new Date().toISOString(),
    reason: null,
    targetTag: null,
    moderatorTag: null,
    channelId: null,
    extra: null,
    ...entry,
  });
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - MAX_ENTRIES);
  save();
  return id;
}

/**
 * Recherche filtrée, la plus récente en premier.
 * @param {string} guildId
 * @param {{ targetId?: string, moderatorId?: string, action?: string, id?: string, since?: Date, limit?: number }} [filters]
 */
function search(guildId, filters = {}) {
  const { targetId, moderatorId, action, id, since, limit = 25 } = filters;
  const results = load()
    .filter((e) => e.guildId === guildId)
    .filter((e) => !targetId || e.targetId === targetId)
    .filter((e) => !moderatorId || e.moderatorId === moderatorId)
    .filter((e) => !action || e.action === action)
    .filter((e) => !id || e.id === id)
    .filter((e) => !since || new Date(e.createdAt) >= since)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return limit ? results.slice(0, limit) : results;
}

/** @returns {boolean} vrai si une entrée a bien été supprimée */
function deleteById(guildId, id) {
  const list = load();
  const index = list.findIndex((e) => e.guildId === guildId && e.id === id);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

/** @returns {number} nombre d'entrées supprimées */
function deleteAllForTarget(guildId, targetId) {
  const list = load();
  const before = list.length;
  cache = list.filter((e) => !(e.guildId === guildId && e.targetId === targetId));
  save();
  return before - cache.length;
}

/** @returns {number} nombre d'entrées supprimées */
function deleteAllForGuild(guildId) {
  const list = load();
  const before = list.length;
  cache = list.filter((e) => e.guildId !== guildId);
  save();
  return before - cache.length;
}

module.exports = { record, search, deleteById, deleteAllForTarget, deleteAllForGuild };
