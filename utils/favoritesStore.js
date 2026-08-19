const fs = require("fs");
const path = require("path");

// Favoris PAR UTILISATEUR et non par serveur : "mes favoris" suit la personne
// d'un serveur à l'autre. Stocké dans DATA_DIR, monté sur un Volume Railway
// en production, donc conservé d'un redéploiement à l'autre.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "favorites.json");

// Un menu déroulant Discord accepte 25 options au maximum : au-delà, la
// playlist ne serait plus affichable d'un seul tenant.
const MAX_FAVORITES = 25;

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
    console.error("[favoritesStore] échec de la sauvegarde :", err);
  }
}

/** @returns {{ title: string, uri: string, author: string|null, length: number }[]} */
function list(userId) {
  return load()[userId] || [];
}

const indexOfUri = (favorites, uri) => favorites.findIndex((f) => f.uri === uri);

/**
 * Ajoute le morceau s'il est absent, le retire s'il est déjà là.
 * @returns {{ added: boolean, full?: boolean, title: string }}
 */
function toggle(userId, track) {
  const data = load();
  const favorites = data[userId] || (data[userId] = []);
  const existing = indexOfUri(favorites, track.uri);

  if (existing !== -1) {
    favorites.splice(existing, 1);
    save();
    return { added: false, title: track.title };
  }

  if (favorites.length >= MAX_FAVORITES) {
    return { added: false, full: true, title: track.title };
  }

  // Ajout en fin de liste (et jamais en tête) : les positions déjà affichées
  // dans un menu ouvert restent valides, puisque c'est l'index qui sert de
  // valeur d'option (voir utils/favoritesPanel.js).
  favorites.push({
    title: track.title,
    uri: track.uri,
    author: track.author || null,
    length: track.length || 0,
  });
  save();
  return { added: true, title: track.title };
}

function has(userId, uri) {
  return indexOfUri(list(userId), uri) !== -1;
}

function removeAt(userId, index) {
  const favorites = list(userId);
  if (index < 0 || index >= favorites.length) return null;
  const [removed] = favorites.splice(index, 1);
  save();
  return removed;
}

module.exports = { list, toggle, has, removeAt, MAX_FAVORITES };
