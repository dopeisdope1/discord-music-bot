const accessStore = require("../accessStore");
const levelStore = require("./levelStore");
const { levelRequiredFor, isOwnerSysOnly } = require("./levelCatalog");

// Pont de rétrocompatibilité : quiconque avait la portée "salon" (accordée
// via l'ancien &panel > Modération) garde ses commandes de salon telles
// quelles — pas de régression pour les accès déjà en place.
const LEGACY_BRIDGE = { "channels.lock": "salon", "channels.manage": "salon" };

/**
 * Niveau EFFECTIF d'un membre sur ce serveur : le plus haut entre son niveau
 * individuel (levelStore::getUserLevel) et celui de chacun de ses rôles — un
 * niveau individuel ne remplace jamais celui d'un rôle, il ne fait que
 * s'ajouter comme un plancher ou un plafond supplémentaire, jamais un recul.
 * Owner/rang sys ne passent jamais par ici (interceptés avant, voir can()).
 * @param {import('discord.js').GuildMember} member
 * @returns {number} 0 si aucun niveau n'est assigné (ni au membre, ni à l'un de ses rôles)
 */
function levelOf(member) {
  if (!member || !member.guild) return 0;
  const guildId = member.guild.id;
  let niveau = levelStore.getUserLevel(guildId, member.id) || 0;
  for (const roleId of member.roles?.cache?.keys?.() || []) {
    const roleLevel = levelStore.getRoleLevel(guildId, roleId);
    if (roleLevel && roleLevel > niveau) niveau = roleLevel;
  }
  return niveau;
}

/**
 * Vrai quand le membre a été explicitement configuré dans le moteur de
 * permissions de ce serveur (un niveau lui est assigné, ou à l'un de ses
 * rôles), ou quand il bénéficie déjà du statut owner/sys.
 *
 * Cette distinction est volontairement plus large que `can(member, key)` :
 * elle sert uniquement à décider si une aide doit rester en mode découverte
 * minimal pour un membre totalement inconnu du système de permissions.
 */
function hasConfiguredAccess(member) {
  if (!member || !member.guild) return false;
  if (accessStore.isOwner(member.id) || accessStore.isSys(member.id)) return true;
  return levelOf(member) > 0;
}

/**
 * SEUL point de vérification des droits sur une clé de permission. Utilisé
 * partout : commandes texte, &help, panel, boutons — pas de logique dupliquée
 * ailleurs.
 *
 * Moteur à NIVEAUX CUMULATIFS (1-9) : chaque clé existante reste le même nom
 * de chaîne qu'avant (aucun des ~230 appels can(member, "clé") dans le reste
 * du bot n'a besoin de changer), mais sa résolution interne compare
 * désormais le NIVEAU EFFECTIF du membre (levelOf ci-dessus) au niveau
 * minimum requis par la clé (utils/permissions/levelCatalog.js::
 * levelRequiredFor) — un membre de niveau 6 a donc accès à TOUT ce que les
 * niveaux 1 à 6 débloquent, pas seulement une liste de clés accordées une
 * par une.
 *
 * Ordre de résolution :
 *  1. clé "toujours owner/sys" (ban de masse, débannissement de masse, don
 *     d'Administrateur à un rôle, gérer les niveaux eux-mêmes, gérer les
 *     accès au panel) -> JAMAIS vraie via un niveau, même 9 — seuls le
 *     propriétaire du bot et le rang sys y ont accès (voir
 *     levelCatalog.js::OWNER_SYS_ONLY_KEYS, 5 garde-fous anti-escalade
 *     repris tels quels de l'ancien catalog.js) ;
 *  2. propriétaire du bot / rang sys (utils/accessStore.js, INCHANGÉ) ;
 *  3. pont de rétrocompatibilité LEGACY_BRIDGE (portée "salon" historique) ;
 *  4. niveau effectif du membre >= niveau requis par la clé.
 *
 * `moderation.banall` garde en plus son cas spécial historique : la
 * propriété DISCORD du serveur (guild.ownerId) y donne aussi accès, même
 * sans être owner du bot ni rang sys — comportement inchangé depuis avant
 * cette refonte (voir utils/banAll.js).
 *
 * @param {import('discord.js').GuildMember} member rôles déjà en cache,
 *   aucun appel Discord supplémentaire.
 * @param {string|string[]|null} key null = commande publique, toujours autorisée.
 * @returns {boolean}
 */
function can(member, key) {
  // Certaines fonctionnalités (notamment &panel) sont accessibles si l'une
  // de plusieurs rubriques est visible. Chaque branche reste résolue par ce
  // même moteur, sans introduire une seconde notion d'autorisation.
  if (Array.isArray(key)) return key.some((permission) => can(member, permission));
  if (!key) return true;
  if (!member || !member.guild) return false;

  if (key === "moderation.banall") {
    return member.id === member.guild.ownerId || accessStore.isAllowed("banall", member.id);
  }

  if (isOwnerSysOnly(key)) {
    return accessStore.isOwner(member.id) || accessStore.isSys(member.id);
  }

  if (accessStore.isOwner(member.id)) return true;
  if (accessStore.isSys(member.id)) return true;

  if (LEGACY_BRIDGE[key] && accessStore.isAllowed(LEGACY_BRIDGE[key], member.id)) return true;

  const required = levelRequiredFor(key);
  // Une clé inconnue du catalogue de niveaux (jamais mappée) ne peut être
  // débloquée par AUCUN niveau — strictement owner/sys, comme les 5
  // garde-fous ci-dessus. Mieux vaut refuser une clé mal orthographiée que
  // l'ouvrir à tout le monde par erreur.
  if (required == null) return false;

  return levelOf(member) >= required;
}

/**
 * Qui peut MODIFIER les niveaux eux-mêmes (assigner un niveau à un rôle/
 * membre) — distinct de can(), qui dit ce qu'on peut FAIRE une fois le
 * niveau obtenu. Équivalent direct de l'ancien "panel.permissions.manage"
 * (ownerOnlyGrant) : un rang sys peut profiter d'un niveau élevé, mais ne
 * peut jamais EN ATTRIBUER à quelqu'un d'autre — sans ce garde-fou, un rang
 * sys pourrait indéfiniment créer d'autres comptes à niveau 9.
 * @param {import('discord.js').GuildMember} accordeur celui qui clique dans le panel.
 * @returns {boolean}
 */
function peutGererNiveaux(accordeur) {
  return Boolean(accordeur) && accessStore.isOwner(accordeur.id);
}

/**
 * Conservée pour compatibilité avec les appelants existants
 * (utils/configPanel.js notamment) : `key` n'est plus un paramètre
 * pertinent dans le système à niveaux (TOUTE attribution de niveau est
 * ownerOnlyGrant, pas seulement certaines clés) — ignoré, toujours équivalent
 * à peutGererNiveaux.
 * @deprecated utiliser peutGererNiveaux
 */
function peutAccorder(accordeur) {
  return peutGererNiveaux(accordeur);
}

module.exports = { can, hasConfiguredAccess, peutAccorder, peutGererNiveaux, levelOf };
