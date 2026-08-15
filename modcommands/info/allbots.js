const { LEVEL } = require("../../utils/permLevels");
const { listField } = require("../../utils/textHelpers");

module.exports = {
  name: "allbots",
  category: "info",
  description: "Affiche la liste des bots du serveur",
  usage: "&allbots",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    await ctx.guild.members.fetch();
    const bots = ctx.guild.members.cache.filter((m) => m.user.bot);

    await ctx.reply(
      ctx.card({
        title: `Bots (${bots.size})`,
        description: listField(bots.map((m) => `<@${m.id}>`), { empty: "Aucun bot." }),
      })
    );
  },
};
