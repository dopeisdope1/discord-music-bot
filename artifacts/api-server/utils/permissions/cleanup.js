const accessStore = require("../accessStore");
const permStore = require("./store");

// Portées globales concernées par le nettoyage (voir utils/accessStore.js).
// "owner" est volontairement absent : c'est une variable d'environnement,
// jamais un accès stocké qu'on pourrait révoquer.
const GLOBAL_SCOPES = ["sys", "banall", "clear", "salon"];

/** Vrai si l'utilisateur est membre d'AU MOINS UN serveur partagé avec le bot. */
function isStillReachable(client, userId) {
  return client.guilds.cache.some((g) => g.members.cache.has(userId));
}

/**
 * Révoque l'accès panel d'un utilisateur qui a quitté TOUS les serveurs
 * partagés avec le bot : octrois individuels du nouveau moteur (par serveur)
 * + portées globales historiques (sys/banall/clear/salon). Ne touche jamais
 * à l'historique de modération (utils/moderationHistoryStore.js) — on
 * retire l'accès, pas les traces (consigne explicite).
 *
 * Le check "sur AUCUN serveur partagé" évite de casser l'accès d'un compte
 * encore légitime sur un autre serveur du bot simplement parce qu'il a
 * quitté celui-ci.
 * @returns {string[]} description des changements effectués, en français
 */
function revokeIfGone(client, guildId, userId) {
  if (isStillReachable(client, userId)) return [];

  const changes = [];
  if (permStore.clearUserGrants(guildId, userId)) changes.push("octrois individuels retirés");
  for (const scope of GLOBAL_SCOPES) {
    if (accessStore.remove(scope, userId)) changes.push(`portée "${scope}" retirée`);
  }
  return changes;
}

/**
 * Balaie tous les utilisateurs actuellement titulaires d'un accès sur ce
 * serveur (octrois individuels + portées globales) et révoque ceux qui ne
 * sont plus membres nulle part. Utilisé par le bouton "Nettoyer les accès
 * obsolètes" du panel (section 28) — la même logique que le nettoyage
 * automatique au départ d'un membre (index.js, guildMemberRemove), pas de
 * seconde implémentation.
 * @returns {string[]} IDs des utilisateurs dont l'accès a été révoqué
 */
function sweepGuild(client, guild) {
  const candidates = new Set([
    ...permStore.listUserGrants(guild.id).map(([id]) => id),
    ...GLOBAL_SCOPES.flatMap((scope) => accessStore.list(scope)),
  ]);

  const revoked = [];
  for (const userId of candidates) {
    if (guild.members.cache.has(userId)) continue;
    if (revokeIfGone(client, guild.id, userId).length) revoked.push(userId);
  }
  return revoked;
}

/**
 * Retire les octrois (et l'étiquette "exclusif") des rôles qui n'existent
 * plus sur le serveur — un rôle supprimé (à la main, ou via &role delete /
 * le provisionnement en masse de utils/rolePresets.js) laisse sinon sa
 * clé traîner indéfiniment dans permissions.json. Sans effet visible sur
 * les permissions elles-mêmes (un rôle inexistant n'en accorde déjà plus
 * aucune, voir utils/permissions/engine.js::can qui lit member.roles.cache),
 * mais ces entrées mortes polluent &perms/&helpall/la rubrique "Rôles
 * (paliers)" : elles y apparaissent comme un palier fantôme, avec une
 * mention de rôle qui ne résout plus rien, et faussent la numérotation des
 * VRAIS paliers (triée par nombre de clés).
 * @param {import('discord.js').Guild} guild
 * @returns {string[]} IDs des rôles dont l'entrée a été retirée
 */
function pruneDeletedRoles(guild) {
  const vivants = guild.roles.cache;
  const removed = [];
  for (const [roleId] of permStore.listRoleGrants(guild.id)) {
    if (vivants.has(roleId)) continue;
    permStore.setRoleGrants(guild.id, roleId, []);
    removed.push(roleId);
  }
  for (const roleId of permStore.listExclusiveRoles(guild.id)) {
    if (vivants.has(roleId)) continue;
    permStore.setRoleExclusive(guild.id, roleId, false);
    if (!removed.includes(roleId)) removed.push(roleId);
  }
  return removed;
}

module.exports = { isStillReachable, revokeIfGone, sweepGuild, pruneDeletedRoles };
