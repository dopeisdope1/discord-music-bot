const fs = require("fs");
const path = require("path");

// Date d'abonnement Nitro renseignée À LA MAIN (voir modcommands/.../setnitro.js).
//
// Pourquoi manuellement : l'API bot de Discord n'expose NI l'abonnement Nitro
// NI sa date de début — vérifié sur un compte Nitro Argent réel, la charge
// utile ne contient ni `premium_type`, ni flag Nitro dans `public_flags`
// (`premium_since` du membre, lui, ne concerne QUE le boost de serveur).
// Sans valeur enregistrée ici, la progression retombe sur `joined_at`
// (arrivée sur le serveur), qui n'est qu'une approximation.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "nitroDates.json");

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
    console.error("[nitroStore] échec de la sauvegarde :", err);
  }
}

function ensureGuild(guildId) {
  const data = load();
  data[guildId] = { ...data[guildId] };
  return data[guildId];
}

/** @returns {Date|null} */
function getNitroStart(guildId, userId) {
  const iso = ensureGuild(guildId)[userId];
  return iso ? new Date(iso) : null;
}

function setNitroStart(guildId, userId, date) {
  const g = ensureGuild(guildId);
  g[userId] = new Date(date).toISOString();
  save();
}

function removeNitroStart(guildId, userId) {
  const g = ensureGuild(guildId);
  const existed = Boolean(g[userId]);
  delete g[userId];
  save();
  return existed;
}

function listAll(guildId) {
  return Object.entries(ensureGuild(guildId)).map(([userId, iso]) => ({ userId, date: new Date(iso) }));
}

/**
 * Accepte "15/04/26", "15/04/2026" et "2026-04-15" (+ heure optionnelle
 * "HH:mm"). Interprété en UTC pour rester cohérent avec l'affichage.
 * @returns {Date|null} null si le format est invalide
 */
function parseDate(input) {
  if (!input) return null;
  const raw = input.trim();

  let year;
  let month;
  let day;
  let rest = "";

  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(.*))?$/);
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(.*))?$/);

  if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
    if (year < 100) year += 2000;
    rest = dmy[4] || "";
  } else if (ymd) {
    year = Number(ymd[1]);
    month = Number(ymd[2]);
    day = Number(ymd[3]);
    rest = ymd[4] || "";
  } else {
    return null;
  }

  let hours = 0;
  let minutes = 0;
  if (rest) {
    const time = rest.match(/^(\d{1,2}):(\d{2})$/);
    if (!time) return null;
    hours = Number(time[1]);
    minutes = Number(time[2]);
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) return null;

  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  // Rejette les dates qui "débordent" (ex: 31/02 devient le 3 mars).
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.getTime() > Date.now()) return null; // pas d'abonnement dans le futur

  return date;
}

function getRawGuildData(guildId) {
  return load()[guildId] || {};
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = {
  getNitroStart,
  setNitroStart,
  removeNitroStart,
  listAll,
  parseDate,
  getRawGuildData,
  hydrateFromRemote,
};
