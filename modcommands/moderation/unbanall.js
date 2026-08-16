const { LEVEL } = require("../../utils/permLevels");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "unbanall",
  category: "moderation",
  description: "Débannit tous les membres bannis du serveur",
  usage: "&unbanall",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const bans = await ctx.guild.bans.fetch();
    let count = 0;
    for (const ban of bans.values()) {
      await ctx.guild.members.unban(ban.user.id, `Unban de masse par ${ctx.author.tag}`).catch(() => {});
      count++;
    }
    sendLog(ctx.client, ctx.guildId, "moderation", {
      title: "Unban de masse",
      description: `${count} membre(s) débanni(s).`,
      actor: ctx.author,
    });

    await ctx.reply(ctx.card({ title: `${count} membre(s) débanni(s).` }));
  },
};
