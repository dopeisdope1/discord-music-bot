const { LEVEL } = require("../../utils/permLevels");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "lock",
  category: "channel",
  description: "Verrouille le salon pour @everyone",
  usage: "&lock",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    await ctx.message.channel.permissionOverwrites.edit(ctx.guild.id, { SendMessages: false }, { reason: `Verrouillage par ${ctx.author.tag}` });
    sendLog(ctx.client, ctx.guildId, "salon", { title: "Lock", description: `<#${ctx.message.channel.id}> verrouillé.`, actor: ctx.author });
    await ctx.reply(ctx.card({ title: "Salon verrouillé pour @everyone." }));
  },
};
