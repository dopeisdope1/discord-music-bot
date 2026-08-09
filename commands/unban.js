const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { canUseCommand } = require("../utils/permissions");
const { randomClearJoke } = require("../utils/jokes");
const { sendLog } = require("../utils/actionLogger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Débannit un membre (Zinki Assassini, recherche en direct)")
    .addStringOption((option) =>
      option
        .setName("membre")
        .setDescription("Tape un pseudo ou un ID parmi les membres bannis")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  /**
   * Suggestions en direct pendant que l'utilisateur tape, uniquement parmi
   * les membres actuellement bannis — aucune liste tant que le champ est vide.
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().trim().toLowerCase();
    if (!focused) return interaction.respond([]);

    const bans = await interaction.guild.bans.fetch().catch(() => null);
    if (!bans) return interaction.respond([]);

    const matches = [...bans.values()].filter(
      (b) => b.user.tag.toLowerCase().includes(focused) || b.user.username.toLowerCase().includes(focused) || b.user.id === focused
    );

    await interaction.respond(matches.slice(0, 25).map((b) => ({ name: b.user.tag.slice(0, 100), value: b.user.id })));
  },

  async execute(interaction) {
    if (!canUseCommand(interaction, "unban")) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Tu n'as pas la permission d'utiliser cette commande.")],
        ephemeral: true,
      });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    }

    const targetId = interaction.options.getString("membre");
    await interaction.deferReply();

    const result = await interaction.guild.bans
      .remove(targetId, `Débanni par ${interaction.user.tag}`)
      .catch((err) => {
        console.error(err);
        return null;
      });

    if (!result) {
      return interaction.editReply({
        embeds: [buildStatusEmbed("error", "Impossible de débannir cet ID (pas banni, ou erreur Discord).")],
      });
    }

    await interaction.editReply({
      embeds: [buildStatusEmbed("success", `<@${targetId}> a été débanni — ${randomClearJoke()}`)],
    });
    sendLog(interaction.client, interaction.guild.id, "moderation", {
      title: "Unban",
      description: "Membre débanni via /unban (Zinki Assassini).",
      actor: interaction.user,
      fields: [{ name: "Cible", value: `<@${targetId}> (${targetId})`, inline: true }],
    });
  },
};
