const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");

module.exports = {
  name: "nick",
  category: "moderation",
  description: "Modifie ou réinitialise le pseudo d'un membre",
  usage: "&nick <@mention | id> [nouveau pseudo]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    const newNick = ctx.args.slice(1).join(" ") || null;
    await target.setNickname(newNick);

    await ctx.reply(
      ctx.card({
        title: newNick ? `Pseudo de ${target.user.tag} changé en "${newNick}".` : `Pseudo de ${target.user.tag} réinitialisé.`,
      })
    );
  },
};
