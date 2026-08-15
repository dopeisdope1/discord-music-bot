const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const muteStore = require("../../utils/muteStore");

module.exports = {
  name: "muteinfo",
  category: "info",
  description: "Affiche les informations du mute actif d'un membre",
  usage: "&muteinfo <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    const active = muteStore.getActive(ctx.guildId, userId);
    if (!active) {
      await ctx.reply(ctx.card({ title: `<@${userId}> n'est pas muté.` }));
      return;
    }

    await ctx.reply(
      ctx.card({
        title: `Mute actif — <@${userId}>`,
        fields: [
          { name: "Raison", value: active.reason || "Aucune" },
          { name: "Par", value: `<@${active.mutedBy}>` },
          { name: "Depuis", value: `<t:${Math.floor(active.mutedAt / 1000)}:R>` },
          { name: "Expire", value: active.expiresAt ? `<t:${Math.floor(active.expiresAt / 1000)}:R>` : "Jamais (rôle)" },
        ],
      })
    );
  },
};
