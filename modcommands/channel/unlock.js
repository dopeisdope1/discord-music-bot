const { LEVEL } = require("../../utils/permLevels");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "unlock",
  category: "channel",
  description: "Déverrouille le salon pour @everyone",
  usage: "&unlock",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    await ctx.message.channel.permissionOverwrites.edit(ctx.guild.id, { SendMessages: null }, { reason: `Déverrouillage par ${ctx.author.tag}` });
    sendLog(ctx.client, ctx.guildId, "salon", { title: "Unlock", description: `<#${ctx.message.channel.id}> déverrouillé.`, actor: ctx.author });
    await ctx.reply(ctx.card({ title: "Salon déverrouillé pour @everyone." }));
  },
};
