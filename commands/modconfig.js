const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  ActionRowBuilder,
  ComponentType,
} = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { getGuildSettings, setModRoleIds } = require("../utils/guildSettings");

const SELECTION_TIMEOUT_MS = 60_000;

function formatRoleList(roleIds) {
  return roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(", ") : "*aucun (rôle par défaut utilisé)*";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("modconfig")
    .setDescription("Configure les rôles autorisés à utiliser les commandes de modération")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const { modRoleIds } = getGuildSettings(interaction.guildId);

    const menu = new RoleSelectMenuBuilder()
      .setCustomId("modconfig_role_select")
      .setPlaceholder("Choisis un ou plusieurs rôles modérateur")
      .setMinValues(0)
      .setMaxValues(10);

    const reply = await interaction.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          `Rôle(s) modérateur actuel(s) : ${formatRoleList(modRoleIds)}\n\n` +
            "Sélectionne les rôles autorisés à utiliser les commandes de modération " +
            "(`-clear`, `-lock`, `-unlock`, `-hide`, `-unhide`, `-renew`, `-snipe`). " +
            "Ne rien sélectionner retire tous les rôles configurés.",
          { title: "Configuration — Modération" }
        ),
      ],
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true,
    });

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.RoleSelect,
      time: SELECTION_TIMEOUT_MS,
      max: 1,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({
          embeds: [buildStatusEmbed("error", "Seule la personne qui a ouvert ce panel peut le configurer.")],
          ephemeral: true,
        });
        return;
      }
      setModRoleIds(interaction.guildId, i.values);
      await i.update({
        embeds: [
          buildStatusEmbed("success", `Rôle(s) modérateur mis à jour : ${formatRoleList(i.values)}`, {
            title: "Configuration — Modération",
          }),
        ],
        components: [],
      });
    });

    collector.on("end", (collected) => {
      if (collected.size === 0) {
        interaction.editReply({ components: [] }).catch(() => {});
      }
    });
  },
};
