const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Quarantaine Admin (voir utils/personalProtection.js, protection perso
// "quarantineAdmin") : snapshot des rôles d'un exécuteur illégitime avant
// de les retirer, pour les lui rendre automatiquement après échéance —
// même principe que utils/tempRoleStore.js, mais inversé (on RETIRE une
// liste de rôles puis on la RESTAURE, au lieu d'accorder un rôle unique
// puis de le retirer).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "adminQuarantine.json");

// 1h de quarantaine : le temps qu'un vrai admin remarque et vérifie, sans
// bloquer indéfiniment quelqu'un sur la seule foi d'une détection
// automatique — pas de commande de levée manuelle en v1 (périmètre
// resserré), la restauration automatique suffit.
const DUREE_MS = 60 * 60 * 1000;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = lireJson(DATA_FILE);
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[adminQuarantineStore] échec de la sauvegarde :", err);
  }
}

/** Snapshot les rôles d'un exécuteur avant de les retirer — un seul enregistrement actif par (guildId, userId) à la fois. */
function add(guildId, userId, roleIds, expiresAt = Date.now() + DUREE_MS) {
  const list = load().filter((q) => !(q.guildId === guildId && q.userId === userId));
  list.push({ guildId, userId, roleIds, expiresAt });
  cache = list;
  save();
}

function remove(guildId, userId) {
  cache = load().filter((q) => !(q.guildId === guildId && q.userId === userId));
  save();
}

/** Quarantaines dont l'échéance est dépassée — à traiter (restaurer les rôles) puis retirer via remove(). */
function getExpired() {
  const now = Date.now();
  return load().filter((q) => q.expiresAt <= now);
}

module.exports = { add, remove, getExpired, DUREE_MS };
