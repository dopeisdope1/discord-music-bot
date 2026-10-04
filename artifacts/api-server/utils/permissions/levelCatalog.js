// Catalogue des NIVEAUX (1 à 9, cumulatifs) — remplace l'ancien système de
// clés nommées accordées une par une (utils/permissions/catalog.js, conservé
// pour mémoire mais plus consommé par engine.js). Un membre/rôle au niveau N
// a accès à tout ce que les niveaux 1..N débloquent — jamais un remplacement
// clé par clé, un VRAI rang cumulatif.
//
// Chaque clé existante (utilisée par can(member, key) dans ~34 fichiers,
// jamais renommée pour ne rien casser) est mappée au niveau minimum requis
// pour l'utiliser. can() calcule le niveau du membre puis compare au niveau
// requis de la clé — voir engine.js.
const LEVEL_MIN = 1;
const LEVEL_MAX = 9;

const KEY_LEVELS = {
  // --- Niveau 1 : lecture / info publique ---
  "server.info.view": 1,
  "server.tools.use": 1,

  // --- Niveau 2 : support léger ---
  "server.members.list": 2,
  "server.stats.view": 2,

  // --- Niveau 3 : modération légère ---
  "moderation.warn": 3,
  "logs.view": 3,
  "protection.automod": 3,

  // --- Niveau 4 : modération courante ---
  "moderation.kick": 4,
  "moderation.timeout": 4,
  "moderation.clear": 4,
  "members.nick": 4,
  "channels.lock": 4,
  "channels.slowmode": 4,

  // --- Niveau 5 : modération renforcée ---
  "moderation.ban": 5,
  "moderation.unban": 5,
  "moderation.softban": 5,
  "moderation.unmuteall": 5,
  "moderation.zinkiller": 5,
  "moderation.reasons": 5,
  "channels.manageall": 5,
  "channels.lockdown": 5,
  "logs.manage": 5,

  // --- Niveau 6 : gestion communauté ---
  "members.role": 6,
  "members.autorole.manage": 6,
  "members.verification.manage": 6,
  "members.rank.manage": 6,
  "server.tickets.manage": 6,
  "server.polls.manage": 6,
  "server.giveaways.manage": 6,
  "server.welcome.manage": 6,
  "server.levels.manage": 6,
  "server.confessions.manage": 6,
  "server.confessions.setup": 6,
  "server.confessions.validation": 6,
  "server.selfclear.manage": 6,
  "moderation.mutebot": 6,

  // --- Niveau 7 : gestion serveur ---
  "channels.manage": 7,
  "server.channels.manage": 7,
  "server.dero.manage": 7,
  "server.voice.manage": 7,
  "server.voice.moveall": 7,
  "server.customcommands.manage": 7,
  "panel.roles.manage": 7,

  // --- Niveau 8 : administration ---
  "server.roles.manage": 8,
  "server.security.scan": 8,

  // --- Niveau 9 : haute administration (délégable — distinct des clés
  // "toujours owner/sys" ci-dessous, qui ne sont JAMAIS délégables même à 9) ---
  // (aucune clé du catalogue existant n'est réservée au 9 pur à ce jour —
  // emplacement prévu pour de futures commandes très sensibles mais
  // délégables, ex. sauvegardes serveur.)
};

// Ces clés ne suivent PAS le système de niveaux : même au niveau 9, un rôle
// ou un membre ordinaire n'y a jamais accès — seuls le propriétaire du bot
// et le rang sys (utils/accessStore.js) le peuvent. Reprend EXACTEMENT les
// anciens garde-fous (roleGrantable:false / ownerOnlyGrant:true) de
// catalog.js, pour qu'aucune de ces 5 protections anti-escalade ne
// disparaisse avec le changement de moteur.
const OWNER_SYS_ONLY_KEYS = new Set([
  "moderation.banall",
  "moderation.unbanall",
  "server.roles.admin_grant",
  "panel.permissions.manage", // équivalent : gérer les niveaux eux-mêmes
  "panel.access.manage", // équivalent : gérer les accès au panel
]);

/** @returns {number|null} niveau requis pour cette clé, ou null si la clé est inconnue (jamais accordée par niveau). */
function levelRequiredFor(key) {
  return Object.prototype.hasOwnProperty.call(KEY_LEVELS, key) ? KEY_LEVELS[key] : null;
}

function isOwnerSysOnly(key) {
  return OWNER_SYS_ONLY_KEYS.has(key);
}

/** Toutes les clés qu'un niveau donné débloque (cumulatif : niveau N -> clés de niveau <= N). */
function keysForLevel(level) {
  return Object.entries(KEY_LEVELS)
    .filter(([, lvl]) => lvl <= level)
    .map(([key]) => key);
}

/** Les clés débloquées À PARTIR de ce niveau (pas en dessous) — pour afficher "ce que ce niveau ajoute" dans le panel. */
function keysAddedAtLevel(level) {
  return Object.entries(KEY_LEVELS)
    .filter(([, lvl]) => lvl === level)
    .map(([key]) => key);
}

module.exports = { LEVEL_MIN, LEVEL_MAX, KEY_LEVELS, OWNER_SYS_ONLY_KEYS, levelRequiredFor, isOwnerSysOnly, keysForLevel, keysAddedAtLevel };
