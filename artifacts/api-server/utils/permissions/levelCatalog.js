// Registre UNIQUE des clés de permission du bot : niveau requis (KEY_LEVELS),
// garde-fous owner/sys (OWNER_SYS_ONLY_KEYS) et libellés/catégories affichés
// (PERMISSIONS, byCategory). Remplace l'ancien système de clés accordées une
// par une (ex-utils/permissions/catalog.js, fusionné ici). Un membre/rôle au niveau N
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
// l'ex-catalog.js, pour qu'aucune de ces 5 protections anti-escalade ne
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

// --- Libellés et catégories affichés (&help, formulaires du panel) ---
// Repris tels quels de l'ex-catalog.js : purement descriptif, n'accorde rien
// (engine.js::can reste l'unique juge, via KEY_LEVELS ci-dessus).
const PERMISSIONS = [
  // --- Salons ---
  { key: "channels.lock", category: "channels", label: "Verrouiller/déverrouiller un salon (&lock, &unlock)" },
  { key: "channels.slowmode", category: "channels", label: "Mode lent (&slowmode)" },
  { key: "channels.manage", category: "channels", label: "Masquer/renouveler un salon, supprimer en lot depuis le panel (&hide, &unhide, &renew)" },
  { key: "channels.manageall", category: "channels", label: "Masquer/réafficher TOUS les salons (&hideall, &unhideall)" },
  { key: "channels.lockdown", category: "channels", label: "Verrouiller/déverrouiller tous les salons (&lockdown, &panic, &unlockdown)" },

  // --- Membres ---
  { key: "members.nick", category: "members", label: "Modifier un pseudo (&nick, &resetnick)" },
  { key: "members.role", category: "members", label: "Ajouter/retirer un rôle (&addrole, &delrole)" },
  { key: "members.autorole.manage", category: "members", label: "Configurer les rôles automatiques à l'arrivée (&autorole, panel)" },
  { key: "members.verification.manage", category: "members", label: "Configurer la vérification (&verify setup, panel)" },
  { key: "members.rank.manage", category: "members", label: "Échelle de grades : promouvoir/rétrograder, configurer l'échelle (&promote, &demote, &gradeladder)" },
  {
    key: "moderation.mutebot",
    category: "moderation",
    label: "Mute bot gradé, verrouillé au grade du poseur (&bmute, &bunmute, &bmutelist, &bmuteresetall)",
  },
  { key: "moderation.clear", category: "moderation", label: "Nettoyer des messages (&clear)" },
  { key: "moderation.kick", category: "moderation", label: "Expulser un membre (&kick)" },
  { key: "moderation.ban", category: "moderation", label: "Bannir un membre (&ban)" },
  { key: "moderation.unban", category: "moderation", label: "Débannir un membre (&unban)" },
  { key: "moderation.softban", category: "moderation", label: "Softban (&softban)" },
  { key: "moderation.timeout", category: "moderation", label: "Timeout / fin de timeout (&timeout, &untimeout, &mute, &unmute)" },
  { key: "moderation.warn", category: "moderation", label: "Avertir un membre (&warn, &unwarn)" },
  { key: "moderation.unmuteall", category: "moderation", label: "Démute de masse (&unmuteall)" },
  { key: "moderation.banall", category: "moderation", label: "Ban de masse (&banall)" },
  { key: "moderation.unbanall", category: "moderation", label: "Débannissement de masse (&unbanall)" },
  {
    key: "moderation.zinkiller",
    category: "moderation",
    label: "Ban persistant, re-banni automatiquement si débanni ailleurs (&zinkiller/&bl, &unzinkiller/&unbl, &zinkillerlist/&bllist, &blinfo, &clearmybl)",
  },
  { key: "moderation.reasons", category: "moderation", label: "Gérer les raisons de ban prédéfinies (&reasonadd, &reasondel, &reasonproof, &reasongrade, &reasonlist)" },
  // Pas de clé pour &userinfo/&avatar/&serverinfo : ce sont des commandes
  // publiques de lecture seule, comme &pic/&banner/&server déjà existantes.

  // --- Logs / historique ---
  { key: "logs.view", category: "logs", label: "Consulter les salons de logs configurés (panel)" },
  { key: "logs.manage", category: "logs", label: "Configurer les salons de logs (panel)" },

  // --- Panel ---
  // (panel.permissions.manage / panel.access.manage : jamais délégables,
  // voir OWNER_SYS_ONLY_KEYS ci-dessus.)
  { key: "panel.permissions.manage", category: "panel", label: "Modifier les permissions par rôle (panel)" },
  { key: "panel.roles.manage", category: "panel", label: "Consulter/gérer les rôles (panel)" },
  { key: "panel.access.manage", category: "panel", label: "Gérer les accès au panel (panel)" },

  // --- Protection --- (anti-spam/anti-nuke/anti-lien migrés vers le bot
  // Secure — seul le rôle de mute générique reste ici, sans rapport)
  { key: "protection.automod", category: "protection", label: "Configurer le rôle de mute et sa limite de nettoyage (&set muterole, &clear limit)" },

  // --- Serveur --- (structure du serveur, distinct de "channels" qui reste
  // limité au salon courant — création/suppression touchent tout le serveur)
  { key: "server.roles.manage", category: "server", label: "Créer/supprimer/modifier un rôle (&role create/delete/rename/color)" },
  {
    key: "server.roles.admin_grant",
    category: "server",
    label: "Donner/retirer Administrateur à un rôle (&role admin)", // jamais délégable — voir checkAdminGrant dans utils/serverAdminCommands.js
  },
  { key: "server.channels.manage", category: "server", label: "Créer/supprimer/renommer un salon (&channel create/delete/rename/topic)" },
  { key: "server.dero.manage", category: "server", label: "Permissions automatiques sur les nouveaux salons (&dero)" },
  { key: "server.voice.manage", category: "server", label: "Modérer les membres en vocal (&voicekick, &voicemove, &bringall)" },
  // Séparée de server.voice.manage : &voicemove/&bringall déplacent TOUS
  // les membres d'un coup, contrairement à &voicekick qui cible une seule
  // personne.
  { key: "server.voice.moveall", category: "server", label: "Déplacer tout un salon vocal d'un coup (&voicemove, &bringall)" },
  { key: "server.tickets.manage", category: "server", label: "Configurer les tickets (&ticket setup)" },
  { key: "server.polls.manage", category: "server", label: "Créer des sondages (&poll)" },
  { key: "server.giveaways.manage", category: "server", label: "Lancer/retirer un giveaway (&giveaway)" },
  { key: "server.welcome.manage", category: "server", label: "Configurer le message de bienvenue (panel)" },
  { key: "server.stats.view", category: "server", label: "Voir les statistiques du serveur (&vc, &stats)" },
  { key: "server.levels.manage", category: "server", label: "Configurer les niveaux/XP (;settings level, panel)" },
  {
    key: "server.members.list",
    category: "server",
    label: "Voir les listes de membres par statut (&alladmins, &botadmins, &boosters, &rolemembers)",
  },
  { key: "server.info.view", category: "server", label: "Voir les fiches d'info détaillées (&vocinfo, &user, &emoji)" },
  { key: "server.tools.use", category: "server", label: "Utiliser les outils annexes (&choose, &wiki, &search wiki)" },
  { key: "server.customcommands.manage", category: "server", label: "Créer/supprimer des commandes personnalisées (&addcmd, &delcmd)" },
  { key: "server.security.scan", category: "server", label: "Lancer un audit de sécurité (&security scan)" },
  { key: "server.confessions.manage", category: "server", label: "Gérer les confessions anonymes en attente (&confess)" },
  { key: "server.confessions.setup", category: "server", label: "Configurer le panneau public de confessions (&confess setup)" },
  { key: "server.confessions.validation", category: "server", label: "Configurer le salon de validation des confessions (&confess validation)" },
  { key: "server.selfclear.manage", category: "server", label: "Configurer les noms et le délai du nettoyage automatique (!!setclear)" },
];

const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

const CATEGORY_LABELS = {
  moderation: "Modération",
  channels: "Salons",
  members: "Membres",
  logs: "Logs",
  panel: "Panel",
  protection: "Protection",
  server: "Serveur",
};

/** Libellé lisible d'une clé (la clé elle-même si inconnue). */
function label(key) {
  return BY_KEY.get(key)?.label || key;
}

/** Permissions groupées par catégorie, dans l'ordre du registre. */
function byCategory() {
  const map = new Map();
  for (const perm of PERMISSIONS) {
    if (!map.has(perm.category)) map.set(perm.category, []);
    map.get(perm.category).push(perm);
  }
  return [...map.entries()].map(([category, permissions]) => ({
    category,
    label: CATEGORY_LABELS[category] || category,
    permissions,
  }));
}

module.exports = {
  LEVEL_MIN,
  LEVEL_MAX,
  KEY_LEVELS,
  OWNER_SYS_ONLY_KEYS,
  levelRequiredFor,
  isOwnerSysOnly,
  keysForLevel,
  keysAddedAtLevel,
  PERMISSIONS,
  CATEGORY_LABELS,
  label,
  byCategory,
};
