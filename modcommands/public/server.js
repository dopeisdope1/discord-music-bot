const { LEVEL } = require("../../utils/permLevels");

module.exports = {
  name: "server",
  category: "public",
  description: "Affiche les informations du serveur",
  usage: "&server",
  level: LEVEL.PUBLIC,
  async execute(ctx) {
    const guild = ctx.guild;
    await guild.members.fetch();
    const bots = guild.members.cache.filter((m) => m.user.bot).size;

    await ctx.reply(
      ctx.card({
        title: guild.name,
        thumbnail: guild.iconURL({ size: 256 }) || undefined,
        fields: [
          { name: "Propriétaire", value: `<@${guild.ownerId}>` },
          { name: "Membres", value: String(guild.memberCount) },
          { name: "Bots", value: String(bots) },
          { name: "Salons", value: String(guild.channels.cache.size) },
          { name: "Rôles", value: String(guild.roles.cache.size) },
          { name: "Créé le", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>` },
        ],
      })
    );
  },
};
