const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const autoroleStore = require("./autoroleStore");
const roleLimitStore = require("./roleLimitStore");

const reply = (message, kind, text, options) => message.reply({ embeds: [buildStatusEmbed(kind, text, options)] });

function parseRoleArg(message, args) {
  return message.mentions.roles?.first() || (args[0] ? message.guild.roles.cache.get(args[0]) : null);
}

const autoroleHandlers = {
  /** &autorole add @rôle */
  async add(client, message, args) {
    if (!can(message.member, "members.autorole.manage")) return;
    const role = parseRoleArg(message, args);
    if (!role) return reply(message, "error", "Indique un rôle : `autorole add @rôle`.");
    if (role.id === message.guild.id) return reply(message, "error", "@everyone ne peut pas être un rôle automatique.");
    if (!autoroleStore.addRole(message.guild.id, role.id)) {
      return reply(message, "info", `**${role.name}** est déjà attribué automatiquement.`);
    }
    return reply(message, "success", `**${role.name}** sera désormais donné à chaque nouvel arrivant.`);
  },

  /** &autorole del @rôle */
  async del(client, message, args) {
    if (!can(message.member, "members.autorole.manage")) return;
    const role = parseRoleArg(message, args);
    if (!role) return reply(message, "error", "Indique un rôle : `autorole del @rôle`.");
    if (!autoroleStore.removeRole(message.guild.id, role.id)) {
      return reply(message, "info", `**${role.name}** n'était pas dans la liste.`);
    }
    return reply(message, "success", `**${role.name}** ne sera plus donné automatiquement.`);
  },

  /** &autorole list */
  async list(client, message) {
    if (!can(message.member, "members.autorole.manage")) return;
    const roles = autoroleStore.getRoleIds(message.guild.id).map((id) => message.guild.roles.cache.get(id)).filter(Boolean);
    if (!roles.length) return reply(message, "info", "Aucun rôle automatique configuré. Ajoute-en avec `autorole add @rôle`.");
    return reply(message, "info", roles.map((r) => `• ${r}`).join("\n"), { title: "Rôles automatiques" });
  },
};

/** Appelé sur guildMemberAdd (voir index.js) — donne tous les rôles configurés, ignore ceux devenus invalides. */
async function applyAutoroles(member) {
  const roleIds = autoroleStore.getRoleIds(member.guild.id);
  if (!roleIds.length) return;
  // &limitrole (utils/roleLimitStore.js) : un rôle plein n'est pas distribué
  // automatiquement à l'arrivée — pas d'erreur, juste omis en silence,
  // comme les rôles supprimés entre-temps (filtre juste au-dessus).
  const valid = roleIds
    .filter((id) => member.guild.roles.cache.has(id))
    .filter((id) => {
      const limite = roleLimitStore.getLimit(member.guild.id, id);
      return limite == null || member.guild.roles.cache.get(id).members.size < limite;
    });
  if (!valid.length) return;
  await member.roles.add(valid, "Rôle(s) automatique(s) à l'arrivée").catch((err) => {
    console.error("[autorole] échec d'attribution :", err.message);
  });
}

module.exports = { autoroleHandlers, applyAutoroles };
