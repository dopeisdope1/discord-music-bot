const { LEVEL } = require("../../utils/permLevels");
const { BotError } = require("../../utils/modErrors");
const { extractChannelId } = require("../../utils/argParsing");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "unhide",
  category: "channel",
  description: "Rend un salon visible à @everyone",
  usage: "&unhide [#salon | nom | id]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const raw = ctx.args[0];
    let channel = ctx.message.channel;
    if (raw) {
      const id = extractChannelId(raw);
      channel = id ? await ctx.guild.channels.fetch(id).catch(() => null) : ctx.guild.channels.cache.find((c) => c.name === raw);
      if (!channel) throw new BotError("Salon introuvable.");
    }

    await channel.permissionOverwrites.edit(ctx.guild.id, { ViewChannel: null }, { reason: `Affiché par ${ctx.author.tag}` });
    sendLog(ctx.client, ctx.guildId, "salon", { title: "Unhide", description: `<#${channel.id}> visible.`, actor: ctx.author });
    await ctx.reply(ctx.card({ title: `👁️ ${channel} visible pour @everyone.` }));
  },
};
