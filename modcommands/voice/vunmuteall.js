const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { BotError } = require("../../utils/modErrors");
const { resolveVoiceChannel, assertBotCan } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vunmuteall",
  category: "voice",
  description: "Rend la parole à tous les membres d'un salon vocal",
  usage: "&vunmuteall [#salon vocal | id | nom]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    assertBotCan(ctx, PermissionFlagsBits.MuteMembers, "Rendre muet les membres");

    const channel = await resolveVoiceChannel(ctx, ctx.args[0], { fallbackToAuthor: true });
    const targets = [...channel.members.values()].filter((m) => m.voice.serverMute);
    if (!targets.length) throw new BotError(`Personne n'est muet dans ${channel}.`);

    let done = 0;
    for (const member of targets) {
      const ok = await member.voice
        .setMute(false, `Unmute vocal de masse par ${ctx.author.tag}`)
        .then(() => true)
        .catch(() => false);
      if (ok) done++;
    }

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Unmute vocal de masse",
      description: `${done} membre(s) ont retrouvé la parole dans ${channel}.`,
      actor: ctx.author,
    });

    await ctx.reply(ctx.card({ title: `${done} membre(s) ont retrouvé la parole dans ${channel.name}.` }));
  },
};
