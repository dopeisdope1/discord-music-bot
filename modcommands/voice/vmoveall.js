const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { resolveVoiceChannel, assertBotCan } = require("../../utils/voiceModHelpers");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "vmoveall",
  category: "voice",
  description: "Déplace tous les membres d'un salon vocal vers un autre",
  usage: "&vmoveall <#salon source | id | nom> <#salon cible | id | nom>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    assertBotCan(ctx, PermissionFlagsBits.MoveMembers, "Déplacer les membres");

    // Un seul argument : source = le salon de l'auteur, cible = l'argument.
    const source = ctx.args[1]
      ? await resolveVoiceChannel(ctx, ctx.args[0])
      : await resolveVoiceChannel(ctx, null, { fallbackToAuthor: true });
    const destination = await resolveVoiceChannel(ctx, ctx.args[1] || ctx.args[0]);

    if (source.id === destination.id) throw new BotError("Les deux salons sont identiques.");

    const members = [...source.members.values()];
    if (!members.length) throw new BotError(`${source} est vide.`);

    let moved = 0;
    for (const member of members) {
      const ok = await member.voice
        .setChannel(destination, `Déplacement de masse par ${ctx.author.tag}`)
        .then(() => true)
        .catch(() => false);
      if (ok) moved++;
    }

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Déplacement vocal de masse",
      description: `${moved} membre(s) déplacé(s) de ${source} vers ${destination}.`,
      actor: ctx.author,
    });

    await ctx.reply(
      ctx.card({
        title: `${moved} membre(s) déplacé(s) vers ${destination.name}.`,
        description: moved < members.length ? `${members.length - moved} échec(s).` : undefined,
      })
    );
  },
};
