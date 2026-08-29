/**
 * Stockage JSON simple et robuste (parties en cours + profils Valorant).
 *
 * - Chargement synchrone au démarrage (les données sont minuscules).
 * - Écriture atomique (fichier temporaire + rename) pour ne jamais laisser un
 *   JSON tronqué derrière un crash / un redémarrage Railway.
 * - Écritures groupées (debounce) : un embed qui bouge 5 fois par seconde
 *   n'écrit pas 5 fois sur le disque.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

class JsonStore {
  constructor(fileName, fallback) {
    this.file = path.join(DATA_DIR, fileName);
    this.data = this.#load(fallback);
    this.timer = null;
  }

  #load(fallback) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(this.file)) return fallback;
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      // On repart du fallback si le fichier a été vidé/corrompu à la main.
      return parsed && typeof parsed === "object" ? { ...fallback, ...parsed } : fallback;
    } catch (error) {
      console.error(`[store] Lecture impossible de ${this.file} :`, error.message);
      return fallback;
    }
  }

  /** Sauvegarde différée (250 ms) — à appeler après chaque modification. */
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, 250);
    this.timer.unref?.();
  }

  /** Sauvegarde immédiate — utilisée à l'arrêt du process. */
  saveNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.error(`[store] Écriture impossible de ${this.file} :`, error.message);
    }
  }
}

// { matches: { [matchId]: Match } }
const matchStore = new JsonStore("matches.json", { matches: {} });
// { users: { [userId]: { riotId, rank: { key, division }, updatedAt } } }
const profileStore = new JsonStore("profiles.json", { users: {} });

// ---- Profils Valorant ----

function getProfile(userId) {
  return profileStore.data.users[userId] || null;
}

function setProfile(userId, { riotId, rank }) {
  const profile = { riotId, rank, updatedAt: Date.now() };
  profileStore.data.users[userId] = profile;
  profileStore.save();
  return profile;
}

// ---- Parties ----

function allMatches() {
  return Object.values(matchStore.data.matches);
}

function getMatch(matchId) {
  return matchStore.data.matches[matchId] || null;
}

function putMatch(match) {
  matchStore.data.matches[match.id] = match;
  matchStore.save();
  return match;
}

function deleteMatch(matchId) {
  delete matchStore.data.matches[matchId];
  matchStore.save();
}

/** Identifiant court, lisible dans le footer de l'embed, et unique. */
function newMatchId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8);
  } while (matchStore.data.matches[id]);
  return id;
}

/** Purge les parties terminées ou trop vieilles (appelée au démarrage). */
function purgeStaleMatches(ttlMs) {
  const now = Date.now();
  let removed = 0;
  for (const match of allMatches()) {
    if (match.status === "ended" || now - match.createdAt > ttlMs) {
      delete matchStore.data.matches[match.id];
      removed += 1;
    }
  }
  if (removed) matchStore.saveNow();
  return removed;
}

function saveAllNow() {
  matchStore.saveNow();
  profileStore.saveNow();
}

module.exports = {
  getProfile, setProfile,
  allMatches, getMatch, putMatch, deleteMatch, newMatchId, purgeStaleMatches,
  save: () => matchStore.save(),
  saveAllNow,
};
