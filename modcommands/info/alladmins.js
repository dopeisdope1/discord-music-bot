const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { listField } = require("../../utils/textHelpers");

module.exports = {
  name: "alladmins",
  category: "info",
  description: "Affiche la liste des administrateurs du serveur",
  usage: "&alladmins",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    await ctx.guild.members.fetch();
    const admins = ctx.guild.members.cache.filter((m) => m.permissions.has(PermissionFlagsBits.Administrator));

    await ctx.reply(
      ctx.card({
        title: `Administrateurs (${admins.size})`,
        description: listField(admins.map((m) => `<@${m.id}>`), { empty: "Aucun administrateur." }),
      })
    );
  },
};
