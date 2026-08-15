const { LEVEL } = require("../../utils/permLevels");
const { BotError } = require("../../utils/modErrors");
const { searchGif } = require("../../utils/gifSearch");

module.exports = {
  name: "gif",
  category: "misc",
  description: "Cherche et envoie un gif",
  usage: "&gif <recherche>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const query = ctx.args.join(" ") || "funny";
    const url = await searchGif(query).catch(() => {
      throw new BotError("Recherche Giphy indisponible pour l'instant, réessaie plus tard.");
    });
    if (!url) {
      await ctx.reply(ctx.card({ title: "Aucun gif trouvé." }));
      return;
    }
    await ctx.reply(ctx.card({ title: `Gif : ${query}`, image: url }));
  },
};
