const { LEVEL } = require("../../utils/permLevels");
const { getPrefixes } = require("../../utils/prefixStore");
const modHelpCatalog = require("../../utils/modHelpCatalog");

module.exports = {
  name: "help",
  category: "public",
  description: "Ouvre le panel d'aide catégorisé des commandes de modération.",
  usage: "&help",
  level: LEVEL.PUBLIC,
  hidden: true, // commande méta, ne figure pas dans son propre catalogue
  async execute(ctx) {
    const prefix = getPrefixes(ctx.guildId).musicMod;
    await ctx.send(modHelpCatalog.renderOverview(prefix));
  },
};
