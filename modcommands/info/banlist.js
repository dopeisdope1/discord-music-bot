const { LEVEL } = require("../../utils/permLevels");
const { listField } = require("../../utils/textHelpers");

module.exports = {
  name: "banlist",
  category: "info",
  description: "Affiche la liste des bans du serveur",
  usage: "&banlist",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const bans = await ctx.guild.bans.fetch();
    await ctx.reply(
      ctx.card({
        title: `Bannissements (${bans.size})`,
        description: listField([...bans.values()].map((b) => `<@${b.user.id}> — ${b.reason || "aucune raison"}`), {
          empty: "Aucun membre banni.",
        }),
      })
    );
  },
};
