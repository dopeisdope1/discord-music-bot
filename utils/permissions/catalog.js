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
  { key: "moderation.timeout", category: "moderation", label: "Timeout / fin de timeout (&timeout, &untimeout)" },
  { key: "moderation.banall", category: "moderation", label: "Ban de masse (&banall)", roleGrantable: false },

  // --- Salons ---
  { key: "channels.lock", category: "channels", label: "Verrouiller/déverrouiller un salon (&lock, &unlock)" },
  { key: "channels.slowmode", category: "channels", label: "Mode lent (&slowmode)" },
  { key: "channels.manage", category: "channels", label: "Masquer/renouveler un salon (&hide, &unhide, &renew)" },
  { key: "channels.lockdown", category: "channels", label: "Verrouillage d'urgence (&lockdown, &panic)" },

  // --- Membres ---
  { key: "members.nick", category: "members", label: "Modifier un pseudo (&nick, &resetnick)" },
  { key: "members.role", category: "members", label: "Ajouter/retirer un rôle (&addrole, &delrole)" },
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
  { key: "server.voice.manage", category: "server", label: "Configurer le salon générateur de vocaux temporaires (&voicehub)" },
  { key: "server.tickets.manage", category: "server", label: "Configurer les tickets (&ticket setup)" },
  { key: "server.polls.manage", category: "server", label: "Créer des sondages (&poll)" },
  { key: "server.giveaways.manage", category: "server", label: "Lancer/retirer un giveaway (&giveaway)" },
  { key: "server.welcome.manage", category: "server", label: "Configurer le message de bienvenue (panel)" },
  { key: "server.levels.manage", category: "server", label: "Configurer les niveaux/XP (;settings level, panel)" },
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
