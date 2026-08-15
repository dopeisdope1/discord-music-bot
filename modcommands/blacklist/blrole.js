const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { extractRoleId } = require("../../utils/argParsing");
const roleBlacklistStore = require("../../utils/roleBlacklistStore");
const { listField } = require("../../utils/textHelpers");
const { saveGuildConfig } = require("../../utils/configChannel");

module.exports = {
  name: "blrole",
  category: "blacklist",
  description: "Gère la blacklist des rôles (ne peuvent être attribués à personne)",
  usage: "&blrole [@role | id]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) {
      const roles = roleBlacklistStore.listRoles(ctx.guildId);
      await ctx.reply(
        ctx.card({
          title: `Rôles blacklistés (${roles.length})`,
          description: listField(roles.map((r) => `<@&${r}>`), { empty: "Aucun rôle blacklisté." }),
        })
      );
      return;
    }

    const roleId = extractRoleId(ctx.args[0]);
    if (!roleId) throw new UsageError(this.usage);

    if (roleBlacklistStore.isRoleBlacklisted(ctx.guildId, roleId)) {
      roleBlacklistStore.removeRole(ctx.guildId, roleId);
      await ctx.reply(ctx.card({ title: `✅ <@&${roleId}> retiré de la blacklist des rôles.` }));
    } else {
      roleBlacklistStore.addRole(ctx.guildId, roleId);
      await ctx.reply(ctx.card({ title: `🚫 <@&${roleId}> ajouté à la blacklist des rôles.` }));
    }

    saveGuildConfig(ctx.guild, ["roleBlacklist"]).catch(() => {});
  },
};
