const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError, PermissionError } = require("../../utils/modErrors");
const { extractChannelId } = require("../../utils/argParsing");
const { canDoVoiceAction } = require("../../utils/voiceAccess");
const { sendLog } = require("../../utils/actionLogger");

const isVoiceChannel = (c) => c && (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);

module.exports = {
  name: "bringcc",
  category: "voice",
  description: "Déplace tous les membres d'un salon vocal vers un autre",
  usage: "&bringcc <#salon source | id> <#salon destination | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    // Même permission que "Déplacer" dans &voc (voir utils/voiceAccess.js) —
    // un simple raccourci en masse, pas une action à part.
    if (!canDoVoiceAction(ctx.member, "move")) {
      throw new PermissionError("Tu n'as pas la permission de déplacer des membres.");
    }

    const fromId = extractChannelId(ctx.args[0]);
    const toId = extractChannelId(ctx.args[1]);
    if (!fromId || !toId) throw new UsageError(this.usage);

    const from = ctx.guild.channels.cache.get(fromId);
    const to = ctx.guild.channels.cache.get(toId);
    if (!isVoiceChannel(from) || !isVoiceChannel(to)) {
      throw new BotError("Les deux salons doivent être des salons vocaux existants.");
    }
    if (from.id === to.id) throw new BotError("Les deux salons doivent être différents.");

    if (!ctx.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
      throw new BotError("Il me manque la permission Déplacer les membres.");
    }

    const targets = [...from.members.values()].filter((m) => !m.user.bot);
    if (!targets.length) throw new BotError(`Aucun membre dans ${from}.`);

    let success = 0;
    let failed = 0;
    for (const member of targets) {
      try {
        await member.voice.setChannel(to, `&bringcc — par ${ctx.author.tag}`);
        success += 1;
      } catch (err) {
        console.error("[bringcc] échec du déplacement :", err);
        failed += 1;
      }
    }

    sendLog(ctx.client, ctx.guildId, "voice", {
      title: "Déplacement de salon en masse",
      description: `${success} membre(s) déplacé(s) de ${from} vers ${to}${failed ? ` (${failed} échec(s))` : ""} via \`&bringcc\`.`,
      actor: ctx.author,
    });

    await ctx.reply(
      ctx.card({
        title: `${success} membre(s) déplacé(s) vers ${to}.`,
        description: failed ? `${failed} échec(s).` : undefined,
      })
    );
  },
};
