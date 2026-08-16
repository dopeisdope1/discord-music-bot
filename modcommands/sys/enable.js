const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { loadAllCommands } = require("../../utils/modCommandLoader");
const commandStateStore = require("../../utils/commandStateStore");

module.exports = {
  name: "enable",
  category: "sys",
  description: "Réactive une commande précédemment désactivée",
  usage: "&enable <commande>",
  level: LEVEL.SYS,
  async execute(ctx) {
    const name = (ctx.args[0] || "").toLowerCase();
    if (!name) throw new UsageError(this.usage);
    if (!loadAllCommands().has(name)) throw new BotError("Commande inconnue.");

    commandStateStore.setDisabled(name, false);
    await ctx.reply(ctx.card({ title: `Commande \`${name}\` réactivée.` }));
  },
};
