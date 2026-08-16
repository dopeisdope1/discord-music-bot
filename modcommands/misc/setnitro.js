const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const nitroStore = require("../../utils/nitroStore");

// Équivalent en commande du bouton "Renseigner ma date Nitro" de &zinki
// (pratique pour renseigner plusieurs membres d'affilée). Même store, mêmes
// règles de validation.
module.exports = {
  name: "setnitro",
  category: "misc",
  description: "Enregistre la date d'abonnement Nitro d'un membre (utilisée par &zinki)",
  usage: "&setnitro <@mention | id> <JJ/MM/AAAA> [HH:mm]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId || !ctx.args[1]) throw new UsageError(this.usage);

    const target = await ctx.guild.members.fetch(userId).catch(() => null);
    if (!target) throw new BotError("Membre introuvable sur ce serveur.");

    const { date, error } = nitroStore.parseAndValidate(ctx.args[1], ctx.args[2], target.user.createdAt);
    if (error) throw new BotError(error);

    nitroStore.setNitroSince(userId, date, ctx.author.id);

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
