const { PermissionFlagsBits } = require("discord.js");
const { sendLog } = require("./actionLogger");
const { fetchAllMembers } = require("./guildMembers");

/**
 * Vérifie qu'un rôle peut être modifié en masse par le bot (permission,
 * rôle géré par une intégration, hiérarchie). Retourne un message d'erreur
 * si invalide, sinon null.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @returns {string|null}
 */
function validateMassRoleTarget(guild, role) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return "Il me manque la permission **Gérer les rôles**.";
  }
  if (role.managed) {
    return "Ce rôle est géré automatiquement (bot/intégration), impossible de le modifier en masse.";
  }
  if (role.position >= guild.members.me.roles.highest.position) {
    return "Ce rôle est plus haut que le mien dans la hiérarchie, je ne peux pas le modifier.";
  }
  return null;
}

/**
 * Ajoute/retire un rôle à tous les membres du serveur (hors bots), puis logue
 * le résultat dans la catégorie "roles" (voir `.panel` > Logs). Utilisé à la
 * fois par la commande texte `.massrole` et par le panel (bouton "Gérer les
 * rôles en masse").
 * @param {object} params
 * @param {import('discord.js').Client} params.client
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').User} params.actor
 * @param {"add"|"remove"} params.action
 * @param {import('discord.js').Role} params.role
 * @returns {Promise<{ success: number, failed: number }>}
 */
async function runMassRole({ client, guild, actor, action, role }) {
  const members = await fetchAllMembers(guild);
  const targets = members.filter(
    (m) => !m.user.bot && (action === "add" ? !m.roles.cache.has(role.id) : m.roles.cache.has(role.id))
  );

  let success = 0;
  let failed = 0;
  for (const member of targets.values()) {
    try {
      if (action === "add") await member.roles.add(role, `Massrole par ${actor.tag}`);
      else await member.roles.remove(role, `Massrole par ${actor.tag}`);
      success += 1;
    } catch (err) {
      console.error(err);
      failed += 1;
    }
  }

  sendLog(client, guild.id, "roles", {
    title: action === "add" ? "Massrole — ajout" : "Massrole — retrait",
    description: `Rôle **${role.name}** ${action === "add" ? "ajouté à" : "retiré de"} **${success}** membre(s)${
      failed ? ` (${failed} échec(s))` : ""
    }.`,
    actor,
  });

  return { success, failed };
}

module.exports = { validateMassRoleTarget, runMassRole };
