const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const { renderProfil } = require("../../utils/zinkiPanel");

module.exports = {
  name: "zinki",
  category: "public",
  description: "Affiche le profil, le badge et le boost d'un membre",
  usage: "&zinki [@mention | id]",
  level: LEVEL.PUBLIC,
  async execute(ctx) {
    const raw = ctx.args[0];
    const targetId = raw ? extractUserId(raw) : ctx.author.id;
    if (!targetId) throw new UsageError(this.usage);

    // `force: true` : état réel au moment de la commande (boost récent...)
    // plutôt que ce qui traîne dans le cache de la gateway.
    const member = await ctx.guild.members.fetch({ user: targetId, force: true }).catch(() => null);
    if (!member) throw new BotError("Membre introuvable sur ce serveur.");

    await ctx.reply(await renderProfil(member, ctx.client, ctx.author.id));
  },
};
