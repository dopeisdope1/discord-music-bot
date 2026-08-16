const { RoleSelectMenuBuilder, ActionRowBuilder, PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");
const addroleConfigStore = require("../../utils/addroleConfigStore");
const { registerHandler } = require("../../utils/modInteractionRegistry");
const { sendLog } = require("../../utils/actionLogger");

async function handle(interaction) {
  const [, , targetId] = interaction.customId.split(":");
  const guildId = interaction.guild.id;
  const cfg = addroleConfigStore.getConfig(guildId);

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) return interaction.update({ content: "Membre introuvable.", components: [] });

  const removed = [];
  const skipped = [];

  for (const roleId of interaction.values) {
    const role = interaction.guild.roles.cache.get(roleId) || (await interaction.guild.roles.fetch(roleId).catch(() => null));
    if (!role || !member.roles.cache.has(roleId)) continue;

    const blocked = cfg.blockedPermissions.some((name) => role.permissions.has(PermissionFlagsBits[name]));
    if (blocked) {
      skipped.push(role.name);
      continue;
    }
    removed.push(role);
  }

  if (removed.length) {
    await member.roles.remove(removed, `delrole par ${interaction.user.tag}`).catch(() => {});
    sendLog(interaction.client, guildId, "roles", {
      title: "Retrait de rôle",
      description: `Rôle(s) **${removed.map((r) => r.name).join(", ")}** retiré(s) de <@${member.id}>.`,
      actor: interaction.user,
    });
  }

  const lines = [];
  if (removed.length) lines.push(`Retiré : ${removed.map((r) => r.name).join(", ")}`);
  if (skipped.length) lines.push(`Bloqué (permission sensible) : ${skipped.join(", ")}`);
  await interaction.update({ content: lines.join("\n") || "Aucun rôle retiré.", components: [] });
}

registerHandler("delrole", handle);

module.exports = {
  name: "delrole",
  category: "moderation",
  description: "Retire un ou plusieurs rôles à un membre",
  usage: "&delrole <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    const cfg = addroleConfigStore.getConfig(ctx.guildId);
    const select = new RoleSelectMenuBuilder()
      .setCustomId(`delrole:pick:${target.id}`)
      .setPlaceholder(`Choisis jusqu'à ${cfg.rolesPerAction} rôle(s) à retirer`)
      .setMinValues(1)
      .setMaxValues(cfg.rolesPerAction);

    await ctx.reply({ components: [new ActionRowBuilder().addComponents(select)] });
  },
};
