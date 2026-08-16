const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const { render } = require("../../utils/vocPanel");

// Une seule commande, une seule permission à donner dans &panel > Permissions,
// qui débloque toutes les actions vocales du panneau (muet, sourdine,
// déplacer, déconnecter) — sans avoir à accorder les vraies permissions
// Discord au rôle.
module.exports = {
  name: "voc",
  aliases: ["voice", "vocal"],
  category: "voice",
  description: "Panneau de gestion vocale d'un membre (muet, sourdine, déplacer, déconnecter)",
  usage: "&voc <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    const target = await ctx.guild.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!target) throw new BotError("Membre introuvable sur ce serveur.");

    await ctx.reply(render(target, ctx.author.id));
  },
};
