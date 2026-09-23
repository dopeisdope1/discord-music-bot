const accessStore = require("../accessStore");
const { getRoleGrants, getUserGrants } = require("./store");
const { isRoleGrantable, isOwnerOnlyGrant } = require("./catalog");

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

// Les commandes vocales ont deux voies d'autorisation, exactement comme
// l'exécution (voiceAccess.peutVocal) : un droit global staff et un octroi
// individuel `voice.<commande>` attribué depuis `=owner`/`=add`. Garder la
// résolution ici permet aux aides de passer par le même `can()` que les
// handlers, sans recopier cette logique dans chaque écran.
const VOICE_GLOBAL_PERMISSION = {
  "voice.mute": "server.voice.manage",
  "voice.unmute": "server.voice.manage",
  "voice.deaf": "server.voice.manage",
  "voice.undeaf": "server.voice.manage",
  "voice.disconnect": "server.voice.manage",
  "voice.mv": "server.voice.manage",
  "voice.join": "server.voice.manage",
  "voice.find": "server.voice.manage",
  "voice.bringall": "server.voice.moveall",
  "voice.wakeup": "server.voice.manage",
};

/**
 * Vrai quand le membre a été explicitement configuré dans le moteur de
 * permissions de ce serveur (octroi individuel ou octroi sur l'un de ses
 * rôles), ou quand il bénéficie déjà du statut owner/sys.
 *
 * Cette distinction est volontairement plus large que `can(member, key)` :
 * elle sert uniquement à décider si une aide doit rester en mode découverte
 * minimal pour un membre totalement inconnu du système de permissions.
 */
function hasConfiguredAccess(member) {
  if (!member || !member.guild) return false;
  if (accessStore.isOwner(member.id) || accessStore.isSys(member.id)) return true;

  const guildId = member.guild.id;
  if (getUserGrants(guildId, member.id).length) return true;

  for (const roleId of member.roles?.cache?.keys?.() || []) {
    if (getRoleGrants(guildId, roleId).length) return true;
  }
  return false;
}

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

  if (accessStore.isOwner(member.id)) return true;
  if (accessStore.isSys(member.id)) return true;

  // Une autorisation globale débloque la commande vocale comme dans
  // voiceAccess.peutVocal ; sinon l'octroi individuel est testé ci-dessous.
  if (VOICE_GLOBAL_PERMISSION[key] && can(member, VOICE_GLOBAL_PERMISSION[key])) return true;

  const guildId = member.guild.id;

  if (getUserGrants(guildId, member.id).includes(key)) return true;

  if (LEGACY_BRIDGE[key] && accessStore.isAllowed(LEGACY_BRIDGE[key], member.id)) return true;

  if (!isRoleGrantable(key)) return false;

  for (const roleId of member.roles.cache.keys()) {
    if (getRoleGrants(guildId, roleId).includes(key)) return true;
  }
  return false;
}

/**
 * Un membre rang sys (non owner) peut aujourd'hui accorder N'IMPORTE
 * QUELLE clé à n'importe quel rôle ou membre depuis &panel > Rôles et
 * permissions — y compris "panel.permissions.manage" elle-même, ce qui
 * revient à pouvoir se donner (ou donner à un tiers) un contrôle total
 * des permissions du serveur en boucle. `can()` reste le SEUL juge de ce
 * qu'un membre peut FAIRE ; celle-ci est le SEUL juge de ce qu'il peut
 * DISTRIBUER — deux questions différentes, jamais mélangées.
 *
 * @param {import('discord.js').GuildMember} accordeur celui qui clique
 *   "Accorder" dans le panel — PAS la cible qui reçoit la permission.
 * @param {string} key la clé du catalogue sur le point d'être accordée.
 * @returns {boolean}
 */
function peutAccorder(accordeur, key) {
  if (!isOwnerOnlyGrant(key)) return true;
  return Boolean(accordeur) && accessStore.isOwner(accordeur.id);
}

module.exports = { can, hasConfiguredAccess, peutAccorder };
