// Registre UNIQUE des clés de permission du bot. Définie une fois ici,
// consommée par le moteur (engine.js), &help (commandCatalog.js), le
// panel (configPanel.js) et chaque commande de modération — aucun autre
// fichier ne doit avoir sa propre liste de droits.
//
// `roleGrantable: false` marque une clé qui ne peut JAMAIS être accordée à
// un rôle depuis le panel, seulement via utils/accessStore.js (portée
// "banall") : le ban de masse reste volontairement un octroi individuel,
// jamais un effet de bord d'un rôle (voir utils/accessStore.js, NO_SYS_INHERIT).
const PERMISSIONS = [
  // --- Modération ---
  { key: "moderation.clear", category: "moderation", label: "Nettoyer des messages (&clear)" },
  { key: "moderation.kick", category: "moderation", label: "Expulser un membre (&kick)" },
  { key: "moderation.ban", category: "moderation", label: "Bannir un membre (&ban)" },
  { key: "moderation.unban", category: "moderation", label: "Débannir un membre (&unban)" },
  { key: "moderation.softban", category: "moderation", label: "Softban (&softban)" },
  { key: "moderation.timeout", category: "moderation", label: "Timeout / fin de timeout (&timeout, &untimeout, &mute, &unmute)" },
  { key: "moderation.warn", category: "moderation", label: "Avertir un membre (&warn, &unwarn)" },
  // Séparée de moderation.timeout : démuter TOUT LE MONDE d'un coup n'a pas
  // à suivre automatiquement le droit de (dé)muter une personne précise.
  { key: "moderation.unmuteall", category: "moderation", label: "Démute de masse (&unmuteall)" },
  { key: "moderation.banall", category: "moderation", label: "Ban de masse (&banall)", roleGrantable: false },
  // Séparée de moderation.unban : signalé — accorder juste "débannir un
  // membre" laissait accéder au débannissement de MASSE, un risque bien
  // plus large (peut réadmettre tout un raid d'un coup) qu'un simple
  // &unban ciblé. Même traitement que son inverse moderation.banall :
  // jamais octroyable par rôle, seulement propriétaire/octroi individuel.
  { key: "moderation.unbanall", category: "moderation", label: "Débannissement de masse (&unbanall)", roleGrantable: false },

  // --- Salons ---
  { key: "channels.lock", category: "channels", label: "Verrouiller/déverrouiller un salon (&lock, &unlock)" },
  { key: "channels.slowmode", category: "channels", label: "Mode lent (&slowmode)" },
  { key: "channels.manage", category: "channels", label: "Masquer/renouveler un salon, supprimer en lot depuis le panel (&hide, &unhide, &renew)" },
  // Séparée de channels.manage pour la même raison que moderation.unbanall
  // ci-dessus : &hide/&unhide touchent UN salon, &hideall/&unhideall
  // touchent TOUT le serveur d'un coup — ne doivent pas être débloquées
  // ensemble par la même permission.
  { key: "channels.manageall", category: "channels", label: "Masquer/réafficher TOUS les salons (&hideall, &unhideall)" },
  { key: "channels.lockdown", category: "channels", label: "Verrouillage d'urgence (&lockdown, &panic)" },

  // --- Membres ---
  { key: "members.nick", category: "members", label: "Modifier un pseudo (&nick, &resetnick)" },
  { key: "members.role", category: "members", label: "Ajouter/retirer un rôle (&addrole, &delrole)" },
  { key: "members.autorole.manage", category: "members", label: "Configurer les rôles automatiques à l'arrivée (&autorole, panel)" },
  { key: "members.verification.manage", category: "members", label: "Configurer la vérification (&verify setup, panel)" },
  // Pas de clé pour &userinfo/&avatar/&serverinfo : ce sont des commandes
  // publiques de lecture seule, comme &pic/&banner/&server déjà existantes.

  // --- Logs / historique ---
  { key: "logs.view", category: "logs", label: "Consulter l'historique de modération (&modlogs, panel)" },
  { key: "logs.manage", category: "logs", label: "Configurer les salons de logs (panel)" },

  // --- Panel ---
  { key: "panel.permissions.manage", category: "panel", label: "Modifier les permissions par rôle (panel)" },
  { key: "panel.roles.manage", category: "panel", label: "Consulter/gérer les rôles (panel)" },
  { key: "panel.access.manage", category: "panel", label: "Gérer les accès au panel (panel)" },

  // --- Protection ---
  { key: "protection.automod", category: "protection", label: "Configurer l'anti-spam (panel)" },
  { key: "protection.whitelist", category: "protection", label: "Gérer la whitelist anti-spam (&whitelist, panel)" },
  { key: "protection.guard.manage", category: "protection", label: "Configurer l'anti-nuke (&antinuke, panel)" },

  // --- Serveur --- (structure du serveur, distinct de "channels" qui reste
  // limité au salon courant — création/suppression touchent tout le serveur)
  { key: "server.roles.manage", category: "server", label: "Créer/supprimer/modifier un rôle (&role create/delete/rename/color)" },
  {
    key: "server.roles.admin_grant",
    category: "server",
    label: "Donner/retirer Administrateur à un rôle (&role admin)",
    roleGrantable: false, // jamais délégable — voir checkAdminGrant dans utils/serverAdminCommands.js
  },
  { key: "server.channels.manage", category: "server", label: "Créer/supprimer/renommer un salon (&channel create/delete/rename/topic)" },
  { key: "server.dero.manage", category: "server", label: "Permissions automatiques sur les nouveaux salons (&dero)" },
  { key: "server.voice.manage", category: "server", label: "Configurer les vocaux temporaires, expulser du vocal (&voicehub, &voicekick, &tempvoc)" },
  // Séparée de server.voice.manage : &voicemove/&bringall déplacent TOUS
  // les membres d'un coup, contrairement à &voicekick qui cible une seule
  // personne — même logique que moderation.unmuteall/channels.manageall.
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
  { key: "server.confessions.manage", category: "server", label: "Gérer les confessions anonymes en attente (!!confess)" },
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

/** Vrai si `key` existe dans le catalogue et peut être accordée à un rôle. */
function isRoleGrantable(key) {
  const perm = BY_KEY.get(key);
  return Boolean(perm) && perm.roleGrantable !== false;
}

function label(key) {
  return BY_KEY.get(key)?.label || key;
}

/** Permissions groupées par catégorie, dans l'ordre du catalogue. */
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

module.exports = { PERMISSIONS, isRoleGrantable, label, byCategory, CATEGORY_LABELS };
