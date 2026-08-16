const { LEVEL } = require("../../utils/permLevels");
const { BotError } = require("../../utils/modErrors");
const { extractChannelId } = require("../../utils/argParsing");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "hide",
  category: "channel",
  description: "Cache un salon à @everyone",
  usage: "&hide [#salon | nom | id]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const raw = ctx.args[0];
    let channel = ctx.message.channel;
    if (raw) {
      const id = extractChannelId(raw);
      channel = id ? await ctx.guild.channels.fetch(id).catch(() => null) : ctx.guild.channels.cache.find((c) => c.name === raw);
      if (!channel) throw new BotError("Salon introuvable.");
    }

    await channel.permissionOverwrites.edit(ctx.guild.id, { ViewChannel: false }, { reason: `Masqué par ${ctx.author.tag}` });
    sendLog(ctx.client, ctx.guildId, "salon", { title: "Hide", description: `<#${channel.id}> caché.`, actor: ctx.author });
    await ctx.reply(ctx.card({ title: `${channel} caché pour @everyone.` }));
  },
};
