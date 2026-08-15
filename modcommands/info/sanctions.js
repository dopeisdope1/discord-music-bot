const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const sanctionsStore = require("../../utils/sanctionsStore");

module.exports = {
  name: "sanctions",
  category: "info",
  description: "Affiche et gère les sanctions d'un membre",
  usage: "&sanctions <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    const rows = sanctionsStore.listForUser(ctx.guildId, userId);
    if (!rows.length) {
      await ctx.reply(ctx.card({ title: `<@${userId}> n'a aucune sanction.` }));
      return;
    }

    const fields = rows.slice(0, 20).map((s) => ({
      name: `#${s.id} — ${s.type.toUpperCase()} — <t:${Math.floor(s.createdAt / 1000)}:d>`,
      value: `Par <@${s.moderatorId}> — ${s.reason || "aucune raison"}`,
    }));

    await ctx.reply(ctx.card({ title: `Sanctions — <@${userId}> (${rows.length})`, fields }));
  },
};
