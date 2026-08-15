const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveTargetMember } = require("../../utils/moderationTargetHelpers");
const muteStore = require("../../utils/muteStore");
const sanctionsStore = require("../../utils/sanctionsStore");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "unmute",
  category: "moderation",
  description: "Unmute un membre du serveur",
  usage: "&unmute <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);

    const cfg = muteStore.getConfig(ctx.guildId);
    if (cfg.mode === "role" && cfg.muteRoleId) {
      await target.roles.remove(cfg.muteRoleId, `Unmute par ${ctx.author.tag}`).catch(() => {});
    } else {
      await target.timeout(null, `Unmute par ${ctx.author.tag}`).catch(() => {});
    }

    muteStore.clearActive(ctx.guildId, target.id);
    sanctionsStore.add(ctx.guildId, target.id, "unmute", null, ctx.author.id);
    sendLog(ctx.client, ctx.guildId, "moderation", {
      title: "Unmute",
      description: `${target.user.tag} a été unmute.`,
      actor: ctx.author,
    });

    await ctx.reply(ctx.card({ title: `🔊 ${target.user.tag} a été unmute.` }));
  },
};
