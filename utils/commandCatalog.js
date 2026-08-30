// Catalogue unique des commandes du bot, partagé par &help ET &panel pour
// qu'ils ne puissent jamais se contredire (section 5/10/35 du cahier des
// charges : un seul système de permissions, pas une liste par endroit).
//
// `permission` est une clé de utils/permissions/catalog.js, résolue via
// utils/permissions/engine.js::can(member, permission) — null = tout le
// monde. `prefix` vaut "main" (préfixe musique) ou "mod" (préfixe &).
// La musique est volontairement absente de ce catalogue : elle vit sur son
// propre préfixe, rappelé en pied de l'aide, et l'encombrait inutilement.
const CATEGORIES = [
  {
    key: "public",
    label: "Public",
    commands: [
      { name: "pic [@membre]", prefix: "mod", permission: null, description: "Affiche l'avatar d'un membre" },
      { name: "avatar [@membre]", prefix: "mod", permission: null, description: "Alias de `pic`" },
      { name: "banner [@membre]", prefix: "mod", permission: null, description: "Affiche la bannière d'un membre" },
      { name: "server", prefix: "mod", permission: null, description: "Affiche les informations du serveur" },
      { name: "serverinfo", prefix: "mod", permission: null, description: "Alias de `server`, plus détaillé" },
      { name: "userinfo [@membre]", prefix: "mod", permission: null, description: "Informations sur un membre (rôles, arrivée, timeout en cours)" },
      { name: "snipe", prefix: "mod", permission: null, description: "Affiche le dernier message supprimé du salon" },
    ],
  },
  {
    key: "moderation",
    label: "Modération",
    commands: [
      // Les trois déclencheurs font strictement la même chose : une seule
      // entrée plutôt que trois lignes identiques.
      {
        name: "uo clear",
        prefix: null,
        permission: null,
        description: "Sans préfixe, efface tes propres messages du salon. Variantes : `anas clear`, `yanis clear`",
      },
      {
        name: "clear <@membre|id> [nombre]",
        prefix: "mod",
        permission: "moderation.clear",
        description: "Supprime les messages récents d'un membre précis dans le salon. Alias : `purge`",
      },
      { name: "kick @membre [raison]", prefix: "mod", permission: "moderation.kick", description: "Expulse un membre" },
      {
        name: "ban [@membre] [raison]",
        prefix: "mod",
        permission: "moderation.ban",
        description: "Bannit un membre (confirmation obligatoire). Sans cible, propose un menu",
      },
      {
        name: "unban [id]",
        prefix: "mod",
        permission: "moderation.unban",
        description: "Débannit un membre. Sans identifiant, propose la liste des bannis",
      },
      { name: "softban @membre [raison]", prefix: "mod", permission: "moderation.softban", description: "Bannit puis débannit aussitôt, purge les messages des dernières 24h" },
      { name: "timeout @membre <durée> [raison]", prefix: "mod", permission: "moderation.timeout", description: "Rend un membre muet (ex : `10m`, `1h`, `1d`)" },
      { name: "untimeout @membre", prefix: "mod", permission: "moderation.timeout", description: "Lève le timeout d'un membre" },
      {
        name: "banall [raison]",
        prefix: "mod",
        permission: "moderation.banall",
        description: "Bannit tout le serveur (confirmation obligatoire)",
      },
      { name: "modlogs [@membre|id]", prefix: "mod", permission: "logs.view", description: "Consulte l'historique de modération" },
    ],
  },
  {
    key: "channels",
    label: "Salons",
    commands: [
      { name: "lock [#salon]", prefix: "mod", permission: "channels.lock", description: "Empêche @everyone d'écrire dans le salon" },
      { name: "unlock [#salon]", prefix: "mod", permission: "channels.lock", description: "Rétablit l'écriture" },
      { name: "slowmode <durée|off> [#salon]", prefix: "mod", permission: "channels.slowmode", description: "Règle le mode lent (ex : `5s`, `1m`, `off`)" },
      { name: "hide", prefix: "mod", permission: "channels.manage", description: "Masque le salon à @everyone" },
      { name: "unhide", prefix: "mod", permission: "channels.manage", description: "Réaffiche le salon" },
      { name: "renew", prefix: "mod", permission: "channels.manage", description: "Recrée le salon à neuf (l'historique est perdu)" },
      { name: "lockdown", prefix: "mod", permission: "channels.lockdown", description: "Verrouille tous les salons gérables (urgence). Alias : `panic`" },
      { name: "unlockdown", prefix: "mod", permission: "channels.lockdown", description: "Lève un lockdown" },
    ],
  },
  {
    key: "members",
    label: "Membres",
    commands: [
      { name: "nick @membre <pseudo>", prefix: "mod", permission: "members.nick", description: "Change le pseudo d'un membre" },
      { name: "resetnick @membre", prefix: "mod", permission: "members.nick", description: "Réinitialise le pseudo d'un membre" },
      { name: "role add @membre @rôle", prefix: "mod", permission: "members.role", description: "Ajoute un rôle à un membre" },
      { name: "role remove @membre @rôle", prefix: "mod", permission: "members.role", description: "Retire un rôle à un membre" },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    commands: [
      // Tout se règle depuis le panneau : permissions, profils, rôles, logs,
      // accès, dispenses, et le rang sys pour le propriétaire seul.
      { name: "panel", prefix: "mod", permission: null, description: "Panneau de configuration (rubriques visibles selon tes droits)" },
      {
        // "sys" n'est pas une clé du catalogue de permissions (elle n'y
        // figure pas, donc jamais octroyable par rôle) : engine.can()
        // laisse passer owner/sys avant même de regarder la clé, ce qui en
        // fait un gate "sys uniquement" par construction, sans code séparé.
        name: "sources [titre ou lien]",
        prefix: "mod",
        permission: "sys",
        description: "Dit d'où le son peut encore venir quand un morceau refuse de se lire",
      },
    ],
  },
];

/**
 * Catégories réellement utilisables par quelqu'un, commandes filtrées selon
 * ses droits. Une catégorie dont rien n'est accessible n'apparaît pas.
 * @param {(permission: string|null) => boolean} canUse
 */
function categoriesFor(canUse) {
  return CATEGORIES.map((category) => ({
    ...category,
    commands: category.commands.filter((cmd) => canUse(cmd.permission)),
  })).filter((category) => category.commands.length > 0);
}

module.exports = { CATEGORIES, categoriesFor };
