const { LEVEL } = require("../../utils/permLevels");
const { extractUserId } = require("../../utils/argParsing");

module.exports = {
  name: "user",
  category: "public",
  description: "Affiche les informations d'un utilisateur",
  usage: "&user [username | @mention]",
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

    await ctx.reply(
      ctx.card({
        title: member.user.tag,
        thumbnail: member.displayAvatarURL({ size: 256 }),
        fields: [
          { name: "ID", value: member.id },
          { name: "Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>` },
          { name: "A rejoint", value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` },
          { name: "Rôles", value: String(member.roles.cache.size - 1) },
        ],
      })
    );
  },
};
