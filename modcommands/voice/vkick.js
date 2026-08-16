const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveVoiceMember, assertBotCan, assertCanActOn } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vkick",
  aliases: ["deco"],
  category: "voice",
  description: "Déconnecte un membre du vocal",
  usage: "&vkick <@mention | id> [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    assertBotCan(ctx, PermissionFlagsBits.MoveMembers, "Déplacer les membres");

    const target = await resolveVoiceMember(ctx, ctx.args[0], this.usage);
    assertCanActOn(ctx, target);

    const from = target.voice.channel;
    const reason = ctx.args.slice(1).join(" ") || "Aucune raison fournie";

    // Déplacer vers `null` = déconnecter du vocal.
    await target.voice.setChannel(null, `${reason} — par ${ctx.author.tag}`);

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Déconnexion vocale",
      description: `${target.user.tag} déconnecté de ${from}.`,
      actor: ctx.author,
      fields: [{ name: "Raison", value: reason }],
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} a été déconnecté du vocal.`, fields: [{ name: "Raison", value: reason }] }));
  },
};
