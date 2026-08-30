const accessStore = require("../accessStore");
const { getRoleGrants, getUserGrants } = require("./store");
const { isRoleGrantable } = require("./catalog");

// Pont de rétrocompatibilité : quiconque avait la portée "salon" (accordée
// via l'ancien &panel > Modération) garde ses commandes de salon telles
// quelles — pas de régression pour les accès déjà en place. Les nouvelles
// clés restent la voie principale pour tout octroi futur. Volontairement
// PAS de pont pour "moderation.clear" (le nouveau &clear, qui supprime les
// messages de N'IMPORTE QUI) : la portée "clear" historique ne donne qu'une
// dispense de quota sur son PROPRE nettoyage, un droit bien plus faible —
// les confondre accorderait silencieusement un pouvoir qui n'a jamais été
// donné.
const LEGACY_BRIDGE = { "channels.lock": "salon", "channels.manage": "salon" };

/**
 * SEUL point de vérification des droits sur une clé de permission. Utilisé
 * partout : commandes texte, &help, panel, boutons — pas de logique dupliquée
 * ailleurs (voir le plan, section "moteur central").
 *
 * Ordre de résolution :
 *  1. propriétaire du bot / rang sys (utils/accessStore.js, INCHANGÉ —
 *     c'est le statut prioritaire que l'utilisateur veut garder tel quel) ;
 *  2. octroi individuel sur ce serveur ;
 *  3. n'importe quel rôle du membre ayant reçu cette clé sur ce serveur.
 *
 * `moderation.banall` est un cas spécial : jamais vrai via un rôle (voir
 * catalog.js, roleGrantable:false) ni via le rang sys — seul
 * accessStore.isAllowed("banall", ...) ou la propriété du serveur y donnent
 * accès, exactement comme avant cette refonte (voir utils/banAll.js).
 *
 * @param {import('discord.js').GuildMember} member rôles déjà en cache,
 *   aucun appel Discord supplémentaire.
 * @param {string|null} key null = commande publique, toujours autorisée.
 * @returns {boolean}
 */
function can(member, key) {
  if (!key) return true;
  if (!member || !member.guild) return false;

  if (key === "moderation.banall") {
    return member.id === member.guild.ownerId || accessStore.isAllowed("banall", member.id);
  }

  if (accessStore.isOwner(member.id)) return true;
  if (accessStore.isSys(member.id)) return true;

  const guildId = member.guild.id;

  if (getUserGrants(guildId, member.id).includes(key)) return true;

  if (LEGACY_BRIDGE[key] && accessStore.isAllowed(LEGACY_BRIDGE[key], member.id)) return true;

  if (!isRoleGrantable(key)) return false;

  for (const roleId of member.roles.cache.keys()) {
    if (getRoleGrants(guildId, roleId).includes(key)) return true;
  }
  return false;
}

module.exports = { can };
