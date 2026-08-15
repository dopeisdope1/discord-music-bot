const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { sendLog } = require("../../utils/actionLogger");

const CUSTOM_EMOJI_RE = /^<(a?):(\w+):(\d+)>$/;

module.exports = {
  name: "create",
  category: "misc",
  description: "Crée un emoji sur le serveur",
  usage: "&create <:emoji:> [nom] | create [nom] (image jointe)",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const emojiMatch = ctx.args[0]?.match(CUSTOM_EMOJI_RE);
    const attachment = ctx.message.attachments.first();

    let attachmentURL;
    let name;

    if (emojiMatch) {
      const [, animated, emojiName, emojiId] = emojiMatch;
      attachmentURL = `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? "gif" : "png"}`;
      name = ctx.args[1] || emojiName;
    } else if (attachment) {
      attachmentURL = attachment.url;
      name = ctx.args[0];
    }

    if (!attachmentURL || !name) throw new UsageError(this.usage);

    const emoji = await ctx.guild.emojis.create({ attachment: attachmentURL, name, reason: `Créé par ${ctx.author.tag}` }).catch((err) => {
      throw new BotError(`Impossible de créer l'emoji : ${err.message}`);
    });

    sendLog(ctx.client, ctx.guildId, "moderation", { title: "Create", description: `Emoji ${emoji} créé.`, actor: ctx.author });
    await ctx.reply(ctx.card({ title: `✅ Emoji créé : ${emoji}` }));
  },
};
