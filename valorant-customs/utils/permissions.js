/**
 * Qui a le droit de faire quoi sur une partie — et de quoi le bot lui-même a
 * besoin pour fonctionner.
 *
 * L'hôte gère SA partie. Gèrent TOUTES les parties :
 *   - le staff du serveur (admins Discord ou rôle STAFF_ROLE_ID) ;
 *   - les propriétaires et gestionnaires du bot, nommés depuis le panneau
 *     (voir utils/access.js).
 */

const { PermissionFlagsBits, PermissionsBitField, OAuth2Scopes } = require("discord.js");
const settings = require("./settings");
const access = require("./access");

function isHost(match, userId) {
  return match.hostId === userId;
}

/** Admin Discord (Gérer le serveur / Modérer) ou porteur du rôle staff configuré. */
function isStaff(member) {
  if (!member) return false;
  if (settings.get("staffRoleId") && member.roles?.cache?.has(settings.get("staffRoleId"))) return true;
  return Boolean(
    member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

/** Droit de gérer la partie : lancer, terminer, avertir, kick, move... */
function canManage(match, member) {
  if (!member) return false;
  return isHost(match, member.id) || access.isManager(member.id) || isStaff(member);
}

/**
 * Permissions du bot, classées par criticité.
 *
 *   required  — sans elles, une partie ne peut pas se dérouler ;
 *   optional  — confort (logs, ménage des messages de commande).
 */
const BOT_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel,     label: "Voir les salons",       need: "required", why: "lire le salon de la partie" },
  { flag: PermissionFlagsBits.SendMessages,    label: "Envoyer des messages",  need: "required", why: "poster le panneau de partie" },
  { flag: PermissionFlagsBits.EmbedLinks,      label: "Intégrer des liens",    need: "required", why: "afficher les panneaux et avertissements" },
  { flag: PermissionFlagsBits.ManageChannels,  label: "Gérer les salons",      need: "required", why: "créer et supprimer les vocaux d'équipe" },
  { flag: PermissionFlagsBits.MoveMembers,     label: "Déplacer des membres",  need: "required", why: "placer chacun dans le vocal de son équipe" },
  { flag: PermissionFlagsBits.Connect,         label: "Se connecter",          need: "required", why: "gérer les vocaux qu'il crée" },
  { flag: PermissionFlagsBits.ManageMessages,  label: "Gérer les messages",    need: "optional", why: "effacer le message de commande" },
  { flag: PermissionFlagsBits.ReadMessageHistory, label: "Voir l'historique",  need: "optional", why: "rafraîchir un ancien panneau" },
];

/** Permissions strictement nécessaires — utilisé au lancement d'une partie. */
const REQUIRED_BOT_PERMISSIONS = BOT_PERMISSIONS.filter((perm) => perm.need === "required");

/** @returns {string[]} la liste des permissions manquantes (vide si tout va bien). */
function missingBotPermissions(guild) {
  const me = guild?.members?.me;
  if (!me) return ["Impossible de lire les permissions du bot"];
  return REQUIRED_BOT_PERMISSIONS.filter((perm) => !me.permissions.has(perm.flag)).map((perm) => perm.label);
}

/**
 * Rapport complet pour le panneau : ✅ / ❌ ligne par ligne.
 *
 * @returns {{ok: boolean, missingRequired: object[], missingOptional: object[], lines: string[], intents: string[]}}
 */
function permissionReport(guild) {
  const me = guild?.members?.me;
  if (!me) {
    return {
      ok: false,
      missingRequired: REQUIRED_BOT_PERMISSIONS,
      missingOptional: [],
      lines: ["❌ Impossible de lire les permissions du bot sur ce serveur."],
      intents: [],
    };
  }

  const lines = BOT_PERMISSIONS.map((perm) => {
    const has = me.permissions.has(perm.flag);
    const mark = has ? "✅" : (perm.need === "required" ? "❌" : "⚠️");
    const suffix = has ? "" : ` — ${perm.why}`;
    return `${mark} ${perm.label}${perm.need === "optional" && !has ? " *(confort)*" : ""}${suffix}`;
  });

  const missingRequired = BOT_PERMISSIONS.filter((perm) => perm.need === "required" && !me.permissions.has(perm.flag));
  const missingOptional = BOT_PERMISSIONS.filter((perm) => perm.need === "optional" && !me.permissions.has(perm.flag));

  return { ok: missingRequired.length === 0, missingRequired, missingOptional, lines, intents: [] };
}

/**
 * Lien d'invitation avec exactement les permissions nécessaires — ni plus, ni
 * moins. On ne demande jamais Administrateur : le panneau propose ce lien, mais
 * c'est un humain qui décide de l'ouvrir.
 */
function inviteUrl(client) {
  const permissions = new PermissionsBitField(BOT_PERMISSIONS.map((perm) => perm.flag));
  try {
    return client.generateInvite({
      scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
      permissions,
    });
  } catch {
    // Client pas encore prêt : on construit l'URL à la main.
    const clientId = client?.application?.id || client?.user?.id;
    if (!clientId) return null;
    return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${permissions.bitfield}`;
  }
}

/**
 * Permissions manquantes sur UN salon précis (le salon de la partie ou la
 * catégorie des vocaux) : une permission peut être accordée au bot globalement
 * mais refusée par un overwrite local — c'est la cause n°1 des « ça marche
 * ailleurs mais pas ici ».
 */
function missingChannelPermissions(channel, flags) {
  const me = channel?.guild?.members?.me;
  if (!me || !channel?.permissionsFor) return [];
  const permissions = channel.permissionsFor(me);
  return BOT_PERMISSIONS
    .filter((perm) => flags.includes(perm.flag) && !permissions?.has(perm.flag))
    .map((perm) => perm.label);
}

module.exports = {
  isHost, isStaff, canManage,
  BOT_PERMISSIONS, REQUIRED_BOT_PERMISSIONS,
  missingBotPermissions, permissionReport, inviteUrl, missingChannelPermissions,
};
