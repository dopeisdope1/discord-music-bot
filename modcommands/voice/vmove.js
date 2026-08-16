const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveVoiceMember, resolveVoiceChannel, assertBotCan, assertCanActOn } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vmove",
  aliases: ["deplacer"],
  category: "voice",
  description: "Déplace un membre vers un autre salon vocal",
  usage: "&vmove <@mention | id> [#salon vocal | id | nom]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    assertBotCan(ctx, PermissionFlagsBits.MoveMembers, "Déplacer les membres");

    const target = await resolveVoiceMember(ctx, ctx.args[0], this.usage);
    assertCanActOn(ctx, target);

    // Sans salon précisé, on ramène la personne dans le sien.
    const channel = await resolveVoiceChannel(ctx, ctx.args[1], { fallbackToAuthor: true });
    const from = target.voice.channel;

    await target.voice.setChannel(channel, `Déplacé par ${ctx.author.tag}`);

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Déplacement vocal",
      description: `${target.user.tag} déplacé de ${from} vers ${channel}.`,
      actor: ctx.author,
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} déplacé vers ${channel.name}.` }));
  },
};
