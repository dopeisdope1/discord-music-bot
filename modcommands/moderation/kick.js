const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");
const sanctionsStore = require("../../utils/sanctionsStore");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "kick",
  category: "moderation",
  description: "Expulse un membre du serveur",
  usage: "&kick <@mention | id> [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    const reason = ctx.args.slice(1).join(" ") || "Aucune raison fournie";
    await target.kick(reason);
    sanctionsStore.add(ctx.guildId, target.id, "kick", reason, ctx.author.id);
    sendLog(ctx.client, ctx.guildId, "moderation", {
      title: "Kick",
      description: `${target.user.tag} a été expulsé.`,
      actor: ctx.author,
      fields: [{ name: "Raison", value: reason }],
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} a été expulsé.`, fields: [{ name: "Raison", value: reason }] }));
  },
};
