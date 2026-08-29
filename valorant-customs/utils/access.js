/**
 * Hiérarchie d'accès au bot.
 *
 *   👑 root          — TOI. Accès total + seul à pouvoir donner ou retirer
 *                      l'ownership. Déterminé automatiquement (propriétaire de
 *                      l'application Discord) et/ou via BOT_OWNER_IDS.
 *                      N'est stocké dans aucun fichier : impossible à perdre,
 *                      impossible à se faire retirer depuis le panneau.
 *   🛡️ propriétaire  — accès complet au bot : toutes les commandes, gestion de
 *                      toutes les parties, ouverture du panneau (sauf la
 *                      section « Propriétaires », réservée au root).
 *   🔧 gestionnaire  — gère toutes les parties (avertir, move, kick, terminer)
 *                      mais n'ouvre pas le panneau.
 *   🎮 joueur        — tout le monde : rejoindre, liste d'attente, /profil, et
 *                      créer ses propres parties (sauf si la création est
 *                      restreinte depuis le panneau).
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "access.json");

const TIERS = {
  root:    { key: "root",    emoji: "👑", label: "Root" },
  owner:   { key: "owner",   emoji: "🛡️", label: "Propriétaire" },
  manager: { key: "manager", emoji: "🔧", label: "Gestionnaire" },
  player:  { key: "player",  emoji: "🎮", label: "Joueur" },
};

// Renseigné au démarrage : propriétaire de l'application Discord (voir ready.js).
let applicationOwnerId = null;

let cache = null;

function load() {
  if (cache) return cache;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    parsed = null;
  }
  cache = {
    owners: Array.isArray(parsed?.owners) ? parsed.owners : [],
    managers: Array.isArray(parsed?.managers) ? parsed.managers : [],
  };
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (error) {
    console.error("[access] Sauvegarde impossible :", error.message);
  }
}

/** Mémorise le propriétaire de l'application (appelé une fois au démarrage). */
function setApplicationOwner(userId) {
  applicationOwnerId = userId || null;
}

/** IDs root : variable d'environnement + propriétaire de l'application. */
function rootIds() {
  const fromEnv = (process.env.BOT_OWNER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, applicationOwnerId].filter(Boolean))];
}

const isRoot = (userId) => rootIds().includes(userId);
const isOwner = (userId) => isRoot(userId) || load().owners.includes(userId);
const isManager = (userId) => isOwner(userId) || load().managers.includes(userId);

/** Ouvre le panneau de contrôle : root et propriétaires uniquement. */
const canOpenPanel = (userId) => isOwner(userId);

/** @returns {"root"|"owner"|"manager"|"player"} */
function tierOf(userId) {
  if (isRoot(userId)) return "root";
  if (load().owners.includes(userId)) return "owner";
  if (load().managers.includes(userId)) return "manager";
  return "player";
}

const tierLabel = (userId) => {
  const tier = TIERS[tierOf(userId)];
  return `${tier.emoji} ${tier.label}`;
};

const listOwners = () => [...load().owners];
const listManagers = () => [...load().managers];

/**
 * Donne l'ownership. Réservé au root — la vérification est faite ici ET par
 * l'appelant : cette autorisation ne doit jamais dépendre d'un seul garde-fou.
 *
 * @returns {{ok: boolean, error?: string}}
 */
function addOwner(actorId, targetId) {
  if (!isRoot(actorId)) return { ok: false, error: "Seul le root peut donner l'ownership du bot." };
  if (isRoot(targetId)) return { ok: false, error: "Cette personne est déjà root." };
  const data = load();
  if (data.owners.includes(targetId)) return { ok: false, error: "Cette personne est déjà propriétaire." };
  data.owners.push(targetId);
  // Un propriétaire n'a plus besoin d'être gestionnaire.
  data.managers = data.managers.filter((id) => id !== targetId);
  save();
  return { ok: true };
}

function removeOwner(actorId, targetId) {
  if (!isRoot(actorId)) return { ok: false, error: "Seul le root peut retirer l'ownership du bot." };
  if (isRoot(targetId)) return { ok: false, error: "Le root ne peut pas être retiré." };
  const data = load();
  if (!data.owners.includes(targetId)) return { ok: false, error: "Cette personne n'est pas propriétaire." };
  data.owners = data.owners.filter((id) => id !== targetId);
  save();
  return { ok: true };
}

/** Les gestionnaires peuvent être nommés par le root et par les propriétaires. */
function addManager(actorId, targetId) {
  if (!isOwner(actorId)) return { ok: false, error: "Réservé aux propriétaires du bot." };
  if (isOwner(targetId)) return { ok: false, error: "Cette personne a déjà un accès supérieur." };
  const data = load();
  if (data.managers.includes(targetId)) return { ok: false, error: "Cette personne est déjà gestionnaire." };
  data.managers.push(targetId);
  save();
  return { ok: true };
}

function removeManager(actorId, targetId) {
  if (!isOwner(actorId)) return { ok: false, error: "Réservé aux propriétaires du bot." };
  const data = load();
  if (!data.managers.includes(targetId)) return { ok: false, error: "Cette personne n'est pas gestionnaire." };
  data.managers = data.managers.filter((id) => id !== targetId);
  save();
  return { ok: true };
}

module.exports = {
  TIERS,
  setApplicationOwner, rootIds,
  isRoot, isOwner, isManager, canOpenPanel, tierOf, tierLabel,
  listOwners, listManagers,
  addOwner, removeOwner, addManager, removeManager,
};
