const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");

module.exports = {
  name: "baninfo",
  category: "info",
  description: "Affiche les informations d'un bannissement",
  usage: "&baninfo <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    const ban = await ctx.guild.bans.fetch(userId).catch(() => null);
    if (!ban) throw new BotError("Ce membre n'est pas banni.");

    await ctx.reply(
      ctx.card({
        title: `Bannissement — ${ban.user.tag}`,
        fields: [{ name: "Raison", value: ban.reason || "Aucune raison" }],
      })
    );
  },
};
