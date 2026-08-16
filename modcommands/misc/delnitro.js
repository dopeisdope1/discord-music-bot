const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const nitroStore = require("../../utils/nitroStore");

// Équivalent en commande du bouton "Réinitialiser" de &zinki.
module.exports = {
  name: "delnitro",
  category: "misc",
  description: "Retire la date d'abonnement Nitro enregistrée d'un membre",
  usage: "&delnitro <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    if (!nitroStore.clearNitroSince(userId)) {
      throw new BotError("Aucune date Nitro n'était enregistrée pour ce membre.");
    }

    await ctx.reply(
      ctx.card({
        title: "Date Nitro retirée",
        description: `La progression Nitro de <@${userId}> n'est plus affichée tant qu'aucune date n'est renseignée.`,
      })
    );
  },
};
