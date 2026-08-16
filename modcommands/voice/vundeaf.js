const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { resolveVoiceMember, assertBotCan, assertCanActOn } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vundeaf",
  category: "voice",
  description: "Rend l'écoute à un membre en vocal",
  usage: "&vundeaf <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    assertBotCan(ctx, PermissionFlagsBits.DeafenMembers, "Rendre sourd les membres");

    const target = await resolveVoiceMember(ctx, ctx.args[0], this.usage);
    assertCanActOn(ctx, target);
    if (!target.voice.serverDeaf) throw new BotError(`**${target.user.tag}** n'est pas sourd.`);

    await target.voice.setDeaf(false, `Undeaf vocal par ${ctx.author.tag}`);

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Undeaf vocal",
      description: `${target.user.tag} a retrouvé l'écoute en vocal.`,
      actor: ctx.author,
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} a retrouvé l'écoute.` }));
  },
};
