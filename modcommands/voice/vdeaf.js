const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { resolveVoiceMember, assertBotCan, assertCanActOn } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vdeaf",
  category: "voice",
  description: "Rend un membre sourd en vocal",
  usage: "&vdeaf <@mention | id> [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    assertBotCan(ctx, PermissionFlagsBits.DeafenMembers, "Rendre sourd les membres");

    const target = await resolveVoiceMember(ctx, ctx.args[0], this.usage);
    assertCanActOn(ctx, target);
    if (target.voice.serverDeaf) throw new BotError(`**${target.user.tag}** est déjà sourd.`);

    const reason = ctx.args.slice(1).join(" ") || "Aucune raison fournie";
    await target.voice.setDeaf(true, `${reason} — par ${ctx.author.tag}`);

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Deaf vocal",
      description: `${target.user.tag} rendu sourd en vocal.`,
      actor: ctx.author,
      fields: [{ name: "Raison", value: reason }],
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} est sourd en vocal.`, fields: [{ name: "Raison", value: reason }] }));
  },
};
