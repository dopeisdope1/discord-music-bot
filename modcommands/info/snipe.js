const { LEVEL } = require("../../utils/permLevels");

module.exports = {
  name: "snipe",
  category: "info",
  description: "Affiche le dernier message supprimé du salon",
  usage: "&snipe",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const entry = ctx.client.snipes.get(ctx.message.channel.id);
    if (!entry) {
      await ctx.reply(ctx.card({ title: "Aucun message supprimé récemment dans ce salon." }));
      return;
    }

    await ctx.reply(
      ctx.card({
        title: "🗑️ Message supprimé",
        description: `${entry.content}\n\n— ${entry.authorTag}`,
        thumbnail: entry.authorAvatar || undefined,
      })
    );
  },
};
