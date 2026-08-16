const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");
const sanctionsStore = require("../../utils/sanctionsStore");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "derank",
  category: "moderation",
  description: "Retire tous les rôles d'un membre",
  usage: "&derank <@mention | id> [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    const reason = ctx.args.slice(1).join(" ") || "Aucune raison fournie";
    const roles = target.roles.cache.filter((r) => r.id !== ctx.guild.id);
    await target.roles.remove(roles, reason);
    sanctionsStore.add(ctx.guildId, target.id, "warn", `derank: ${reason}`, ctx.author.id);
    sendLog(ctx.client, ctx.guildId, "roles", {
      title: "Derank",
      description: `Tous les rôles de ${target.user.tag} ont été retirés.`,
      actor: ctx.author,
    });

    await ctx.reply(ctx.card({ title: `Tous les rôles de ${target.user.tag} ont été retirés.` }));
  },
};
