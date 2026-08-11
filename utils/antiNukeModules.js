// Liste canonique des "modules" anti-nuke : chacun correspond à un type
// d'action destructrice détectée par utils/antiNuke.js, et sert aussi à
// construire la whitelist granulaire (`=wl`) — un membre whitelisté peut
// l'être pour un ou plusieurs modules précis, ou "all" (tous). Regroupés par
// catégorie pour l'affichage (menus déroulants dans le panel/les commandes).
const MODULE_GROUPS = {
  salons: {
    label: "Salons",
    modules: {
      channelCreate: "Création de salon",
      channelDelete: "Suppression de salon",
      channelUpdate: "Modification de salon",
      channelPermissionUpdate: "Modification des permissions des salons",
    },
  },
  categories: {
    label: "Catégories",
    modules: {
      categoryCreate: "Création de catégorie",
      categoryDelete: "Suppression de catégorie",
      categoryUpdate: "Modification de catégorie",
      categoryPermissionUpdate: "Modification des permissions des catégories",
    },
  },
  roles: {
    label: "Rôles",
    modules: {
      roleCreate: "Création de rôle",
      roleDelete: "Suppression de rôle",
      roleUpdate: "Modification de rôle",
      roleAdminGrant: "Permission Administrateur sur un rôle",
    },
  },
  evenements: {
    label: "Événements",
    modules: {
      eventCreate: "Création d'évent",
      eventUpdate: "Modification d'évent",
      eventDelete: "Suppression d'évent",
    },
  },
  threads: {
    label: "Threads",
    modules: {
      threadCreate: "Création de thread",
      threadDelete: "Suppression de thread",
      threadUpdate: "Modification de thread",
    },
  },
  membres: {
    label: "Membres",
    modules: {
      kick: "Expulser un membre",
      ban: "Bannir un membre",
      timeout: "Timeout d'un membre",
      nickname: "Modification de pseudo",
      voiceDisconnect: "Déconnexion vocale d'un membre",
      voiceMove: "Déplacement vocal d'un membre",
      voiceMuteDeafen: "Mute/Sourdine serveur d'un membre",
      massRoleRemoval: "Retrait de rôles massif",
    },
  },
  serveur: {
    label: "Serveur",
    modules: {
      guildUpdate: "Modification du serveur",
      boostLevelDisable: "Désactivation des niveaux de boosts",
    },
  },
  webhooksEtBots: {
    label: "Webhooks",
    modules: {
      webhookCreate: "Création d'un webhook",
      botAdd: "Ajout d'un bot",
    },
  },
};

// Map "clé de module" -> libellé, à plat (pratique pour l'affichage/lookup).
const MODULE_LABELS = Object.fromEntries(
  Object.values(MODULE_GROUPS).flatMap((group) => Object.entries(group.modules))
);

const ALL_MODULES = Object.keys(MODULE_LABELS);

module.exports = { MODULE_GROUPS, MODULE_LABELS, ALL_MODULES };
