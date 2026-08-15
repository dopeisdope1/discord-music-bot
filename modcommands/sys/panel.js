const { LEVEL } = require("../../utils/permLevels");
const modPanel = require("../../utils/modPanel");

module.exports = {
  name: "panel",
  category: "sys",
  description: "Panel de configuration du bot par serveur",
  usage: "&panel",
  level: LEVEL.SYS,
  async execute(ctx) {
    await ctx.send(modPanel.renderRoot(ctx.guildId));
  },
};
