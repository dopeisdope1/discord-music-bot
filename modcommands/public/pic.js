const { LEVEL } = require("../../utils/permLevels");
const { extractUserId } = require("../../utils/argParsing");

module.exports = {
  name: "pic",
  category: "public",
  description: "Affiche l'avatar d'un utilisateur",
  usage: "&pic [username | @mention]",
  level: LEVEL.PUBLIC,
  async execute(ctx) {
    const raw = ctx.args[0];
    const userId = raw ? extractUserId(raw) : ctx.author.id;
    const member = userId
      ? await ctx.guild.members.fetch(userId).catch(() => null)
      : ctx.guild.members.cache.find((m) => m.user.username === raw);

    if (!member) {
      await ctx.reply(ctx.card({ title: "❌ Utilisateur introuvable" }));
      return;
    }

    await ctx.reply(ctx.card({ title: `Avatar de ${member.user.tag}`, image: member.displayAvatarURL({ size: 1024 }) }));
  },
};
