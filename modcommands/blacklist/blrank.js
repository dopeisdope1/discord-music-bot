const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const roleBlacklistStore = require("../../utils/roleBlacklistStore");
const { listField } = require("../../utils/textHelpers");
const { saveGuildConfig } = require("../../utils/configChannel");

module.exports = {
  name: "blrank",
  category: "blacklist",
  description: "Gère la blacklist des membres (ne peuvent plus recevoir de rôles)",
  usage: "&blrank [@mention | id]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) {
      const members = roleBlacklistStore.listMembers(ctx.guildId);
      await ctx.reply(
        ctx.card({
          title: `Membres blacklistés (${members.length})`,
          description: listField(members.map((m) => `<@${m}>`), { empty: "Aucun membre blacklisté." }),
        })
      );
      return;
    }

    const userId = extractUserId(ctx.args[0]);
    if (!userId) throw new UsageError(this.usage);

    if (roleBlacklistStore.isMemberBlacklisted(ctx.guildId, userId)) {
      roleBlacklistStore.removeMember(ctx.guildId, userId);
      await ctx.reply(ctx.card({ title: `<@${userId}> retiré de la blacklist des membres.` }));
    } else {
      roleBlacklistStore.addMember(ctx.guildId, userId);
      await ctx.reply(ctx.card({ title: `<@${userId}> ajouté à la blacklist des membres.` }));
    }

    saveGuildConfig(ctx.guild, ["roleBlacklist"]).catch(() => {});
  },
};
