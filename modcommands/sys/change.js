const { LEVEL, ALL_LEVELS } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { loadAllCommands } = require("../../utils/modCommandLoader");
const commandStateStore = require("../../utils/commandStateStore");

module.exports = {
  name: "change",
  category: "sys",
  description: `Change le niveau d'une commande (${ALL_LEVELS.join(", ")})`,
  usage: "&change <commande> <niveau>",
  level: LEVEL.SYS,
  async execute(ctx) {
    const name = (ctx.args[0] || "").toLowerCase();
    const level = ctx.args[1];
    if (!name || !level) throw new UsageError(this.usage);
    if (!loadAllCommands().has(name)) throw new BotError("Commande inconnue.");
    if (!ALL_LEVELS.includes(level)) throw new BotError(`Niveau invalide. Valeurs possibles : ${ALL_LEVELS.join(", ")}`);

    commandStateStore.setLevel(name, level);
    await ctx.reply(ctx.card({ title: `Niveau de \`${name}\` réglé sur \`${level}\`.` }));
  },
};
