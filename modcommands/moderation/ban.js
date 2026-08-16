const { LEVEL } = require("../../utils/permLevels");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");
const sanctionsStore = require("../../utils/sanctionsStore");
const { sendLog } = require("../../utils/actionLogger");
const { handleBanPanel } = require("../../utils/banPanel");

module.exports = {
  name: "ban",
  category: "moderation",
  description: "Bannit un membre du serveur",
  usage: "&ban [@mention | id] [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    // Sans argument : panel de recherche interactif "Zinki Assassini" (hérité
    // de l'ancien système, voir utils/banPanel.js). Avec un membre en argument :
    // bannissement direct, avec raison.
    if (!ctx.args[0]) return handleBanPanel(ctx.message);

    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    const reason = ctx.args.slice(1).join(" ") || "Aucune raison fournie";
    await ctx.guild.members.ban(target.id, { reason });
    sanctionsStore.add(ctx.guildId, target.id, "ban", reason, ctx.author.id);
    sendLog(ctx.client, ctx.guildId, "moderation", {
      title: "Ban",
      description: `Membre banni via \`${this.usage.split(" ")[0]}\`.`,
      actor: ctx.author,
      fields: [{ name: "Cible", value: `${target.user.tag} (${target.id})` }],
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} a été banni.`, fields: [{ name: "Raison", value: reason }] }));
  },
};
