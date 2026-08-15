const { LEVEL } = require("../../utils/permLevels");
const { BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const sanctionsStore = require("../../utils/sanctionsStore");
const { handleUnbanPanel, unbanById } = require("../../utils/banPanel");

module.exports = {
  name: "unban",
  category: "moderation",
  description: "Débannit un membre du serveur",
  usage: "&unban [id] [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    // Sans argument : liste des bannis avec menu de sélection (voir utils/banPanel.js).
    if (!ctx.args[0]) return handleUnbanPanel(ctx.message);

    const userId = extractUserId(ctx.args[0]);
    if (!userId) return handleUnbanPanel(ctx.message);

    const ban = await ctx.guild.bans.fetch(userId).catch(() => null);
    if (!ban) throw new BotError("Ce membre n'est pas banni.");

    // unbanById gère déjà la réponse et le log (voir utils/banPanel.js).
    await unbanById(ctx.message, userId);
    sanctionsStore.add(ctx.guildId, userId, "unban", ctx.args.slice(1).join(" ") || null, ctx.author.id);
  },
};
