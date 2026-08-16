const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { resolveVoiceMember, assertBotCan, assertCanActOn } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vmute",
  category: "voice",
  description: "Rend un membre muet en vocal",
  usage: "&vmute <@mention | id> [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    assertBotCan(ctx, PermissionFlagsBits.MuteMembers, "Rendre muet les membres");

    const target = await resolveVoiceMember(ctx, ctx.args[0], this.usage);
    assertCanActOn(ctx, target);
    if (target.voice.serverMute) throw new BotError(`**${target.user.tag}** est déjà muet.`);

    const reason = ctx.args.slice(1).join(" ") || "Aucune raison fournie";
    await target.voice.setMute(true, `${reason} — par ${ctx.author.tag}`);

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Mute vocal",
      description: `${target.user.tag} rendu muet en vocal.`,
      actor: ctx.author,
      fields: [{ name: "Raison", value: reason }],
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} est muet en vocal.`, fields: [{ name: "Raison", value: reason }] }));
  },
};
