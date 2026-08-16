const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");
const sanctionsStore = require("../../utils/sanctionsStore");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "warn",
  category: "moderation",
  description: "Avertit un membre du serveur",
  usage: "&warn <@mention | id> <raison>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0] || !ctx.args[1]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    const reason = ctx.args.slice(1).join(" ");
    sanctionsStore.add(ctx.guildId, target.id, "warn", reason, ctx.author.id);
    await target.send(`Tu as reçu un avertissement sur **${ctx.guild.name}** : ${reason}`).catch(() => {});
    sendLog(ctx.client, ctx.guildId, "moderation", {
      title: "Warn",
      description: `${target.user.tag} a été averti.`,
      actor: ctx.author,
      fields: [{ name: "Raison", value: reason }],
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} a été averti.`, fields: [{ name: "Raison", value: reason }] }));
  },
};
