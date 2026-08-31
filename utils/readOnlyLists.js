const { PermissionFlagsBits } = require("discord.js");
const { can } = require("./permissions/engine");

// Listes de membres en LECTURE SEULE, définies une seule fois pour servir
// deux chemins qui doivent rester d'accord :
//   - la commande texte, qui poste la première page ;
//   - le sélecteur de page de la carte, traité dans
//     utils/serverAdminCommands.js::handleServerAdminInteraction.
// D'où la forme `build(guild, arg)` : rien n'est gardé en mémoire entre les
// deux, tout est recalculé depuis le serveur au moment du clic.

/** Trie du plus haut rôle au plus bas, puis par pseudo, pour un rendu stable. */
function sortMembers(members) {
  return [...members].sort((a, b) => b.roles.highest.position - a.roles.highest.position || a.user.tag.localeCompare(b.user.tag));
}

const formatMember = (m) => `<@${m.id}> (${m.user.tag}, ${m.id})`;

const isAdmin = (m) => m.permissions.has(PermissionFlagsBits.Administrator);

const DEFINITIONS = {
  bots: {
    permission: (member) => can(member, "sys"),
    build: (guild) => ({
      title: "Liste des bots",
      description: "Tous les comptes bot présents sur ce serveur.",
      items: sortMembers(guild.members.cache.filter((m) => m.user.bot).values()).map(formatMember),
    }),
  },

  alladmins: {
    build: (guild) => ({
      title: "Membres administrateurs",
      description: "Membres (hors bots) ayant la permission Administrateur — le propriétaire du serveur inclus.",
      items: sortMembers(guild.members.cache.filter((m) => !m.user.bot && isAdmin(m)).values()).map(formatMember),
    }),
  },

  botadmins: {
    build: (guild) => ({
      title: "Bots administrateurs",
      description: "Comptes bot ayant la permission Administrateur — la surface d'attaque la plus large du serveur.",
      items: sortMembers(guild.members.cache.filter((m) => m.user.bot && isAdmin(m)).values()).map(formatMember),
    }),
  },

  boosters: {
    build: (guild) => ({
      title: "Membres boostant le serveur",
      description: `Niveau de boost actuel : ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts).`,
      // Trié du boost le plus ancien au plus récent : l'ordre attendu d'une
      // liste de soutiens, pas l'ordre hiérarchique des rôles.
      items: [...guild.members.cache.filter((m) => m.premiumSince).values()]
        .sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp)
        .map((m) => `<@${m.id}> — depuis <t:${Math.floor(m.premiumSinceTimestamp / 1000)}:R>`),
    }),
  },

  rolemembers: {
    build: (guild, roleId) => {
      const role = guild.roles.cache.get(roleId);
      if (!role) return null;
      return {
        title: `Membres du rôle ${role.name}`,
        description: `Tous les membres ayant ${role} sur ce serveur.`,
        items: sortMembers(guild.members.cache.filter((m) => m.roles.cache.has(role.id)).values()).map(formatMember),
      };
    },
  },
};

/**
 * Les listes se lisent dans le cache des membres : sans cet appel, un gros
 * serveur ne renvoie que les membres déjà vus (souvent quelques dizaines).
 * L'échec est volontairement silencieux — mieux vaut une liste partielle
 * qu'aucune réponse.
 */
async function ensureMembersCached(guild) {
  if (guild.members.cache.size >= guild.memberCount) return;
  await guild.members.fetch().catch(() => null);
}

module.exports = { DEFINITIONS, ensureMembersCached, sortMembers, formatMember };
