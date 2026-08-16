const { LEVEL } = require("../../utils/permLevels");
const muteStore = require("../../utils/muteStore");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "unmuteall",
  category: "moderation",
  description: "Unmute tous les membres mutés du serveur",
  usage: "&unmuteall",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const cfg = muteStore.getConfig(ctx.guildId);
    const active = muteStore.listActive(ctx.guildId);

    let count = 0;
    for (const row of active) {
      const member = await ctx.guild.members.fetch(row.userId).catch(() => null);
      if (member) {
        if (cfg.mode === "role" && cfg.muteRoleId) {
          await member.roles.remove(cfg.muteRoleId, "Unmute de masse").catch(() => {});
        } else {
          await member.timeout(null, "Unmute de masse").catch(() => {});
        }
      }
      muteStore.clearActive(ctx.guildId, row.userId);
      count++;
    }

    sendLog(ctx.client, ctx.guildId, "moderation", { title: "Unmute de masse", description: `${count} membre(s) unmute.`, actor: ctx.author });
    await ctx.reply(ctx.card({ title: `${count} membre(s) unmute.` }));
  },
};
