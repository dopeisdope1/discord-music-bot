const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractRoleId } = require("../../utils/argParsing");
const { validateMassRoleTarget, runMassRole } = require("../../utils/massRole");

module.exports = {
  name: "massrole",
  category: "misc",
  description: "Ajoute/retire un rôle en masse à tous les membres du serveur",
  usage: "&massrole <add|remove> <@role | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const action = (ctx.args[0] || "").toLowerCase();
    const roleId = extractRoleId(ctx.args[1]);
    if ((action !== "add" && action !== "remove") || !roleId) throw new UsageError(this.usage);

    const role = await ctx.guild.roles.fetch(roleId).catch(() => null);
    if (!role) throw new BotError("Rôle introuvable.");

    const invalidReason = validateMassRoleTarget(ctx.guild, role);
    if (invalidReason) throw new BotError(invalidReason);

    const { success, failed } = await runMassRole({ client: ctx.client, guild: ctx.guild, actor: ctx.author, action, role });

    await ctx.reply(
      ctx.card({
        title: `Rôle ${role.name} ${action === "add" ? "ajouté à" : "retiré de"} ${success} membre(s).`,
        description: failed ? `${failed} échec(s).` : undefined,
      })
    );
  },
};
