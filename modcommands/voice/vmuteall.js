const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { BotError } = require("../../utils/modErrors");
const { resolveVoiceChannel, assertBotCan } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vmuteall",
  category: "voice",
  description: "Rend muets tous les membres d'un salon vocal",
  usage: "&vmuteall [#salon vocal | id | nom]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    assertBotCan(ctx, PermissionFlagsBits.MuteMembers, "Rendre muet les membres");

    const channel = await resolveVoiceChannel(ctx, ctx.args[0], { fallbackToAuthor: true });
    // On ne se mute pas soi-même, ni le bot.
    const targets = [...channel.members.values()].filter((m) => m.id !== ctx.author.id && m.id !== ctx.client.user.id);
    if (!targets.length) throw new BotError(`Personne à rendre muet dans ${channel}.`);

    let done = 0;
    for (const member of targets) {
      if (member.voice.serverMute) continue;
      const ok = await member.voice
        .setMute(true, `Mute vocal de masse par ${ctx.author.tag}`)
        .then(() => true)
        .catch(() => false);
      if (ok) done++;
    }

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Mute vocal de masse",
      description: `${done} membre(s) rendus muets dans ${channel}.`,
      actor: ctx.author,
    });

    await ctx.reply(ctx.card({ title: `${done} membre(s) rendus muets dans ${channel.name}.` }));
  },
};
