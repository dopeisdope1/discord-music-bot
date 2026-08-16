const fs = require("fs");
const path = require("path");

// "Voice Master" : des rôles autorisés à gérer le vocal (déplacer, rendre
// muet...) SANS leur donner les vraies permissions Discord correspondantes,
// qui s'appliqueraient partout et sans garde-fou de hiérarchie.
//
// Voie d'accès parallèle à la commande `voc` des slots de permissions : un
// membre passe s'il a l'une OU l'autre (voir utils/voiceAccess.js).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "voiceMaster.json");

// Actions configurables, dans l'ordre d'affichage du panel.
const ACTIONS = [
  { key: "move", label: "Déplacer les membres" },
  { key: "mute", label: "Rendre muet / rendre la parole" },
  { key: "deaf", label: "Mettre en sourdine / réactiver" },
  { key: "disconnect", label: "Déconnecter du vocal" },
];

const DEFAULTS = { roles: [], actions: ACTIONS.map((a) => a.key) };

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
    console.error("[voiceMasterStore] échec de la sauvegarde :", err);
  }
}

// Renormalisé à chaque appel : un {} vide restauré depuis "zinki-config" ne
// doit pas passer pour une config complète (mêmes raisons que muteStore).
function ensureGuild(guildId) {
  const data = load();
  data[guildId] = { ...DEFAULTS, ...data[guildId] };
  return data[guildId];
}

function getConfig(guildId) {
  const g = ensureGuild(guildId);
  return { roles: [...g.roles], actions: [...g.actions] };
}

function setRoles(guildId, roleIds) {
  ensureGuild(guildId).roles = [...new Set(roleIds)];
  save();
}

function setActions(guildId, actionKeys) {
  ensureGuild(guildId).actions = actionKeys.filter((k) => ACTIONS.some((a) => a.key === k));
  save();
}

/** Le membre porte-t-il un rôle Voice Master ? */
function isVoiceMaster(guildId, member) {
  const { roles } = getConfig(guildId);
  if (!roles.length) return false;
  return member.roles.cache.hasAny?.(...roles) ?? roles.some((r) => member.roles.cache.has(r));
}

/** Ce rôle Voice Master autorise-t-il cette action précise ? */
function allowsAction(guildId, action) {
  return getConfig(guildId).actions.includes(action);
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
  ACTIONS,
  getConfig,
  setRoles,
  setActions,
  isVoiceMaster,
  allowsAction,
  getRawGuildData,
  hydrateFromRemote,
};
