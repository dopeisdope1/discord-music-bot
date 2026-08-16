const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const nitroStore = require("../../utils/nitroStore");
const { saveGuildConfig } = require("../../utils/configChannel");

module.exports = {
  name: "setnitro",
  category: "misc",
  description: "Enregistre la date d'abonnement Nitro d'un membre (utilisée par &zinki)",
  usage: "&setnitro <@mention | id> <15/04/2026 [13:24]>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    const raw = ctx.args.slice(1).join(" ");
    if (!raw) throw new UsageError(this.usage);

    const date = nitroStore.parseDate(raw);
    if (!date) {
      throw new BotError(
        "Date invalide. Formats acceptés : `15/04/26`, `15/04/2026`, `2026-04-15`, avec heure optionnelle `15/04/2026 13:24`. Elle ne peut pas être dans le futur."
      );
    }

    nitroStore.setNitroStart(ctx.guildId, userId, date);
    saveGuildConfig(ctx.guild, ["nitroDates"]).catch(() => {});

    await ctx.reply(
      ctx.card({
        title: "Date Nitro enregistrée",
        fields: [
          { name: "Membre", value: `<@${userId}>` },
          { name: "Abonné depuis", value: `<t:${Math.floor(date.getTime() / 1000)}:F>` },
        ],
      })
    );
  },
};
