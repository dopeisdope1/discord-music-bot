const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const ownerTrustStore = require("../../utils/ownerTrustStore");
const { listField } = require("../../utils/textHelpers");
const { saveGuildConfig } = require("../../utils/configChannel");

module.exports = {
  name: "banalladmins",
  category: "moderation",
  description: "Gère qui peut déclencher &banall (hors propriétaire du serveur/du bot)",
  usage: "&banalladmins [add|remove] [@mention]",
  level: LEVEL.OWNER,
  async execute(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();

    if (sub !== "add" && sub !== "remove") {
      const trusted = ownerTrustStore.list(ctx.guildId);
      await ctx.reply(
        ctx.card({
          title: `Admins de confiance pour &banall (${trusted.length})`,
          description: listField(trusted.map((id) => `<@${id}>`), { empty: "Aucun admin de confiance ajouté." }),
        })
      );
      return;
    }

    if (!(ctx.isSuperSys || ctx.author.id === ctx.guild.ownerId)) {
      throw new BotError("Seul le propriétaire du serveur ou un owner du bot peut modifier cette liste.");
    }

    const targetId = extractUserId(ctx.args[1]);
    if (!targetId) throw new UsageError(this.usage);

    if (sub === "add") {
      ownerTrustStore.add(ctx.guildId, targetId);
      await ctx.reply(ctx.card({ title: `<@${targetId}> peut désormais déclencher &banall.` }));
    } else {
      ownerTrustStore.remove(ctx.guildId, targetId);
      await ctx.reply(ctx.card({ title: `<@${targetId}> ne peut plus déclencher &banall.` }));
    }

    saveGuildConfig(ctx.guild, ["ownerTrust"]).catch(() => {});
  },
};
