const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { loadAllCommands } = require("../../utils/modCommandLoader");
const commandStateStore = require("../../utils/commandStateStore");

module.exports = {
  name: "disable",
  category: "sys",
  description: "Désactive une commande sur tout le bot",
  usage: "&disable <commande>",
  level: LEVEL.SYS,
  async execute(ctx) {
    const name = (ctx.args[0] || "").toLowerCase();
    if (!name) throw new UsageError(this.usage);
    if (!loadAllCommands().has(name)) throw new BotError("Commande inconnue.");
    if (name === "enable" || name === "disable") throw new BotError("Impossible de désactiver cette commande.");

    commandStateStore.setDisabled(name, true);
    await ctx.reply(ctx.card({ title: `⛔ Commande \`${name}\` désactivée sur tout le bot.` }));
  },
};
