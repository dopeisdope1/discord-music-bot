const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const nitroStore = require("../../utils/nitroStore");
const { saveGuildConfig } = require("../../utils/configChannel");

module.exports = {
  name: "delnitro",
  category: "misc",
  description: "Retire la date d'abonnement Nitro enregistrée d'un membre",
  usage: "&delnitro <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    if (!nitroStore.removeNitroStart(ctx.guildId, userId)) {
      throw new BotError("Aucune date Nitro n'était enregistrée pour ce membre.");
    }
    saveGuildConfig(ctx.guild, ["nitroDates"]).catch(() => {});

    await ctx.reply(
      ctx.card({
        title: "Date Nitro retirée",
        description: `<@${userId}> repasse sur la date d'arrivée sur le serveur.`,
      })
    );
  },
};
