const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractRoleId } = require("../../utils/argParsing");
const { listField } = require("../../utils/textHelpers");

module.exports = {
  name: "rolemembers",
  category: "info",
  description: "Affiche la liste des membres ayant un rôle spécifique",
  usage: "&rolemembers <@role | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const roleId = extractRoleId(ctx.args[0]);
    if (!roleId) throw new UsageError(this.usage);

    const role = await ctx.guild.roles.fetch(roleId).catch(() => null);
    if (!role) throw new BotError("Rôle introuvable.");

    await ctx.guild.members.fetch();
    const members = role.members.map((m) => `<@${m.id}>`);

    await ctx.reply(
      ctx.card({
        title: `Membres avec le rôle ${role.name} (${members.length})`,
        description: listField(members, { empty: "Aucun membre avec ce rôle." }),
      })
    );
  },
};
