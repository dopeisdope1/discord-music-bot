const { RoleSelectMenuBuilder, ActionRowBuilder, PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");
const addroleConfigStore = require("../../utils/addroleConfigStore");
const roleBlacklistStore = require("../../utils/roleBlacklistStore");
const { registerHandler } = require("../../utils/modInteractionRegistry");
const { sendLog } = require("../../utils/actionLogger");

function isRoleBlocked(role, blockedPermissionNames, guildId) {
  if (roleBlacklistStore.isRoleBlacklisted(guildId, role.id)) return true;
  return blockedPermissionNames.some((name) => role.permissions.has(PermissionFlagsBits[name]));
}

async function handle(interaction) {
  const [, , targetId] = interaction.customId.split(":");
  const guildId = interaction.guild.id;
  const cfg = addroleConfigStore.getConfig(guildId);

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) return interaction.update({ content: "❌ Membre introuvable.", components: [] });

  const applied = [];
  const skipped = [];

  for (const roleId of interaction.values) {
    const role = interaction.guild.roles.cache.get(roleId) || (await interaction.guild.roles.fetch(roleId).catch(() => null));
    if (!role) continue;
    if (isRoleBlocked(role, cfg.blockedPermissions, guildId)) {
      skipped.push(role.name);
      continue;
    }
    applied.push(role);
  }

  if (applied.length) {
    await member.roles.add(applied, `addrole par ${interaction.user.tag}`).catch(() => {});
    sendLog(interaction.client, guildId, "roles", {
      title: "Ajout de rôle",
      description: `Rôle(s) **${applied.map((r) => r.name).join(", ")}** ajouté(s) à <@${member.id}>.`,
      actor: interaction.user,
    });
  }

  const lines = [];
  if (applied.length) lines.push(`✅ Ajouté : ${applied.map((r) => r.name).join(", ")}`);
  if (skipped.length) lines.push(`⛔ Bloqué (permission sensible ou rôle blacklisté) : ${skipped.join(", ")}`);
  await interaction.update({ content: lines.join("\n") || "Aucun rôle appliqué.", components: [] });
}

registerHandler("addrole", handle);

module.exports = {
  name: "addrole",
  category: "moderation",
  description: "Ajoute un ou plusieurs rôles à un membre",
  usage: "&addrole <@mention | id>",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    if (roleBlacklistStore.isMemberBlacklisted(ctx.guildId, target.id)) {
      throw new BotError("Ce membre est blacklisté et ne peut plus recevoir de rôle (&blrank).");
    }

    const cfg = addroleConfigStore.getConfig(ctx.guildId);
    const select = new RoleSelectMenuBuilder()
      .setCustomId(`addrole:pick:${target.id}`)
      .setPlaceholder(`Choisis jusqu'à ${cfg.rolesPerAction} rôle(s) à ajouter`)
      .setMinValues(1)
      .setMaxValues(cfg.rolesPerAction);

    await ctx.reply({ components: [new ActionRowBuilder().addComponents(select)] });
  },
};
