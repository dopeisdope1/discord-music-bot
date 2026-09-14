const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("../jsonFile");

// Même patron que utils/accessStore.js et utils/prefixStore.js : DATA_DIR
// pointe vers un Volume Railway monté, sans quoi les octrois seraient
// perdus à chaque redéploiement.
//
// Contrairement à accessStore.js (portées globales sys/banall/clear/salon,
// délibérément inchangées — voir le plan), ce fichier est PAR SERVEUR :
// { [guildId]: { roleGrants: { [roleId]: [clé, ...] }, userGrants: { [userId]: [clé, ...] } } }
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "permissions.json");

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
    console.error("[permissions/store] échec de la sauvegarde :", err);
  }
}

function guildData(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { roleGrants: {}, userGrants: {}, exclusiveRoles: [], exclusiveLabels: {}, permsDisplay: {}, tierNames: {} };
  if (!data[guildId].roleGrants) data[guildId].roleGrants = {};
  if (!data[guildId].userGrants) data[guildId].userGrants = {};
  if (!data[guildId].exclusiveRoles) data[guildId].exclusiveRoles = [];
  if (!data[guildId].exclusiveLabels) data[guildId].exclusiveLabels = {};
  if (!data[guildId].permsDisplay) data[guildId].permsDisplay = {};
  if (!data[guildId].tierNames) data[guildId].tierNames = {};
  return data[guildId];
}

const getRoleGrants = (guildId, roleId) => [...(guildData(guildId).roleGrants[roleId] || [])];
const getUserGrants = (guildId, userId) => [...(guildData(guildId).userGrants[userId] || [])];

/** Remplace intégralement les clés accordées à un rôle (édition en un envoi depuis le panel). */
function setRoleGrants(guildId, roleId, keys) {
  const data = guildData(guildId);
  if (keys.length) data.roleGrants[roleId] = [...new Set(keys)];
  else delete data.roleGrants[roleId];
  save();
}

function grantToUser(guildId, userId, key) {
  const data = guildData(guildId);
  const list = data.userGrants[userId] || (data.userGrants[userId] = []);
  if (list.includes(key)) return false;
  list.push(key);
  save();
  return true;
}

function revokeFromUser(guildId, userId, key) {
  const data = guildData(guildId);
  const list = data.userGrants[userId];
  const index = list ? list.indexOf(key) : -1;
  if (index === -1) return false;
  list.splice(index, 1);
  if (!list.length) delete data.userGrants[userId];
  save();
  return true;
}

/** Retire TOUS les octrois individuels d'un membre sur un serveur (départ, nettoyage). @returns {boolean} */
function clearUserGrants(guildId, userId) {
  const data = guildData(guildId);
  if (!data.userGrants[userId]) return false;
  delete data.userGrants[userId];
  save();
  return true;
}

/** Rôles ayant au moins une clé accordée sur ce serveur, avec leurs clés. */
function listRoleGrants(guildId) {
  return Object.entries(guildData(guildId).roleGrants).filter(([, keys]) => keys.length);
}

/** Membres ayant un octroi individuel sur ce serveur, avec leurs clés. */
function listUserGrants(guildId) {
  return Object.entries(guildData(guildId).userGrants).filter(([, keys]) => keys.length);
}

// "Exclusif" : simple étiquette posée par l'admin sur un rôle depuis le
// panel — aucun effet sur le calcul des permissions (utils/permissions/
// engine.js::can n'y touche pas), juste un marqueur affiché à part pour
// distinguer d'un coup d'œil les rôles "à part" (ex. un rôle dédié à une
// seule permission précise) des rôles cumulés normalement.
const isRoleExclusive = (guildId, roleId) => guildData(guildId).exclusiveRoles.includes(roleId);

/**
 * @param {string|null} [label] Nom affiché à part pour ce rôle exclusif (ex:
 *   "Syndicat") au lieu du bloc générique "Exclusives" — voir
 *   utils/permsCommands.js::buildTierCard. Retiré automatiquement si le rôle
 *   redevient non-exclusif.
 */
function setRoleExclusive(guildId, roleId, exclusive, label = null) {
  const data = guildData(guildId);
  const has = data.exclusiveRoles.includes(roleId);
  let changed = false;
  if (exclusive && !has) {
    data.exclusiveRoles.push(roleId);
    changed = true;
  } else if (!exclusive && has) {
    data.exclusiveRoles = data.exclusiveRoles.filter((id) => id !== roleId);
    changed = true;
  }
  if (!exclusive) {
    if (data.exclusiveLabels[roleId]) {
      delete data.exclusiveLabels[roleId];
      changed = true;
    }
  } else if (label && data.exclusiveLabels[roleId] !== label) {
    data.exclusiveLabels[roleId] = label;
    changed = true;
  }
  if (changed) save();
}

const listExclusiveRoles = (guildId) => [...guildData(guildId).exclusiveRoles];
const getExclusiveLabel = (guildId, roleId) => guildData(guildId).exclusiveLabels[roleId] || null;

/**
 * Texte affiché tel quel sur &perms pour ce rôle, au lieu des commandes
 * RÉELLEMENT débloquées par ses clés (utils/permsCommands.js::
 * commandsForKeys) — posé par utils/rolePresets.js pour reproduire
 * exactement la référence fournie (avec des noms de commandes qui n'existent
 * pas toutes dans ce bot). N'affecte ni les vraies permissions ni &helpall
 * (qui montre des rôles, pas des commandes) : purement cosmétique sur une
 * seule ligne d'affichage.
 */
function setPermsDisplay(guildId, roleId, texte) {
  const data = guildData(guildId);
  if (texte) data.permsDisplay[roleId] = texte;
  else delete data.permsDisplay[roleId];
  save();
}
const getPermsDisplay = (guildId, roleId) => guildData(guildId).permsDisplay[roleId] || null;

// Nom donné à un palier depuis le panel (« Permission 4 — Modération »).
//
// Rattaché à la SIGNATURE du palier (ses clés triées,
// utils/permsCommands.js::tierSignature), jamais à son numéro : le numéro
// n'est qu'un rang d'affichage et se décale dès qu'un palier plus petit
// apparaît — un nom rattaché au numéro se retrouverait sur le mauvais palier.
//
// Purement de l'affichage : rien ici n'entre dans le calcul des permissions
// (utils/permissions/engine.js ne lit pas ce champ). Un palier reste le groupe
// des rôles ayant exactement les mêmes clés ; on ne fait que l'étiqueter.
const NOM_PALIER_MAX = 60;

function setTierName(guildId, signature, nom) {
  const data = guildData(guildId);
  const propre = String(nom || "").replace(/\s+/g, " ").trim().slice(0, NOM_PALIER_MAX);
  if (propre) data.tierNames[signature] = propre;
  else delete data.tierNames[signature];
  save();
  return propre || null;
}
const getTierName = (guildId, signature) => guildData(guildId).tierNames[signature] || null;

module.exports = {
  getRoleGrants,
  getUserGrants,
  setRoleGrants,
  grantToUser,
  revokeFromUser,
  clearUserGrants,
  listRoleGrants,
  listUserGrants,
  isRoleExclusive,
  setRoleExclusive,
  listExclusiveRoles,
  getExclusiveLabel,
  setPermsDisplay,
  getPermsDisplay,
  setTierName,
  getTierName,
  NOM_PALIER_MAX,
};
