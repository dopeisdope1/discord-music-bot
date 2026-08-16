const fs = require("fs");
const path = require("path");
const { DateTime } = require("luxon");

// Date d'abonnement Nitro, saisie À LA MAIN uniquement.
//
// L'API bot de Discord n'expose RIEN sur le Nitro : ni statut, ni date.
// `premium_type` a fuité un temps vers les bots (discord-api-docs#6623), mais
// Discord a patché. Vérifié sur un compte Nitro Argent réel : ni
// `premium_type`, ni flag dans `public_flags`, ni bannière. Aucune détection
// automatique n'est possible, et AUCUNE heuristique (joined_at, création du
// compte...) ne doit servir d'approximation — une date fausse est pire que
// pas de date.
//
// Stockage GLOBAL par utilisateur (le Nitro est lié au compte, pas au
// serveur), dans DATA_DIR — sur Railway c'est un volume persistant monté sur
// /data, donc pas besoin de passer par le salon "zinki-config".
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "nitro.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = { users: {} };
  }
  if (!cache.users) cache.users = {};
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

/**
 * @returns {{ nitro_since: number, set_by: string, set_at: number }|null}
 *   `nitro_since` et `set_at` en millisecondes epoch.
 */
function getEntry(userId) {
  return load().users[userId] || null;
}

/** @returns {Date|null} */
function getNitroSince(userId) {
  const entry = getEntry(userId);
  return entry ? new Date(entry.nitro_since) : null;
}

/**
 * @param {string} userId
 * @param {Date|number} nitroSince
 * @param {string} setBy id de la personne qui a saisi la date
 */
function setNitroSince(userId, nitroSince, setBy) {
  const data = load();
  data.users[userId] = {
    nitro_since: new Date(nitroSince).getTime(),
    set_by: setBy,
    set_at: Date.now(),
  };
  save();
}

/** @returns {boolean} true si une date existait bien */
function clearNitroSince(userId) {
  const data = load();
  const existed = Boolean(data.users[userId]);
  delete data.users[userId];
  save();
  return existed;
}

/**
 * Construit et valide une date à partir des champs du modal.
 * @param {string} dateInput "JJ/MM/AAAA"
 * @param {string} timeInput "HH:mm" (vide = 00:00)
 * @param {Date} accountCreatedAt borne basse : un abonnement ne peut pas
 *   précéder la création du compte
 * @returns {{ date: Date }|{ error: string }}
 */
function parseAndValidate(dateInput, timeInput, accountCreatedAt) {
  const rawDate = (dateInput || "").trim();
  const rawTime = (timeInput || "").trim();

  const dmy = rawDate.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (!dmy) return { error: "Format de date invalide. Attendu : `JJ/MM/AAAA` (ex : `15/04/2026`)." };

  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  const year = Number(dmy[3]);

  let hour = 0;
  let minute = 0;
  if (rawTime) {
    const hm = rawTime.match(/^(\d{1,2})[:hH](\d{2})$/);
    if (!hm) return { error: "Format d'heure invalide. Attendu : `HH:mm` (ex : `13:24`), ou laisse vide." };
    hour = Number(hm[1]);
    minute = Number(hm[2]);
    if (hour > 23 || minute > 59) {
      return { error: "Heure impossible. Attendu entre `00:00` et `23:59`." };
    }
  }

  const dt = DateTime.fromObject({ year, month, day, hour, minute }, { zone: "utc" });
  if (!dt.isValid) {
    return { error: "Date impossible : ce jour n'existe pas dans ce mois (ex : `31/02`)." };
  }

  const date = dt.toJSDate();

  if (date.getTime() > Date.now()) {
    return { error: "Cette date est dans le futur." };
  }
  if (accountCreatedAt && date.getTime() < new Date(accountCreatedAt).getTime()) {
    const created = Math.floor(new Date(accountCreatedAt).getTime() / 1000);
    return { error: `Cette date précède la création du compte (<t:${created}:D>).` };
  }

  return { date };
}

module.exports = { getEntry, getNitroSince, setNitroSince, clearNitroSince, parseAndValidate };
