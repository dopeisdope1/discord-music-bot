const { LEVEL } = require("../../utils/permLevels");
const muteStore = require("../../utils/muteStore");
const { listField } = require("../../utils/textHelpers");

module.exports = {
  name: "mutelist",
  category: "info",
  description: "Affiche la liste des membres mutés",
  usage: "&mutelist",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const active = muteStore.listActive(ctx.guildId);
    await ctx.reply(
      ctx.card({
        title: `Membres mutés (${active.length})`,
        description: listField(active.map((a) => `<@${a.userId}> — ${a.reason || "aucune raison"}`), {
          empty: "Aucun membre muté.",
        }),
      })
    );
  },
};
