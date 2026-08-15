const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "rename",
  category: "channel",
  description: "Renomme le salon actuel",
  usage: "&rename <nom>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const name = ctx.args.join(" ");
    if (!name) throw new UsageError(this.usage);

    const oldName = ctx.message.channel.name;
    await ctx.message.channel.setName(name, `Renommé par ${ctx.author.tag}`);
    sendLog(ctx.client, ctx.guildId, "salon", { title: "Rename", description: `#${oldName} renommé en #${name}.`, actor: ctx.author });
    await ctx.reply(ctx.card({ title: `✏️ Salon renommé en "${name}".` }));
  },
};
