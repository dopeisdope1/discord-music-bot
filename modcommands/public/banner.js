const { LEVEL } = require("../../utils/permLevels");
const { extractUserId } = require("../../utils/argParsing");

module.exports = {
  name: "banner",
  category: "public",
  description: "Affiche la bannière d'un utilisateur",
  usage: "&banner [username | @mention]",
  level: LEVEL.PUBLIC,
  async execute(ctx) {
    const raw = ctx.args[0];
    const userId = raw ? extractUserId(raw) : ctx.author.id;
    const targetId = userId || ctx.author.id;
    const user = await ctx.client.users.fetch(targetId, { force: true }).catch(() => null);

    if (!user) {
      await ctx.reply(ctx.card({ title: "Utilisateur introuvable" }));
      return;
    }
    if (!user.bannerURL()) {
      await ctx.reply(ctx.card({ title: `${user.tag} n'a pas de bannière.` }));
      return;
    }

    await ctx.reply(ctx.card({ title: `Bannière de ${user.tag}`, image: user.bannerURL({ size: 1024 }) }));
  },
};
