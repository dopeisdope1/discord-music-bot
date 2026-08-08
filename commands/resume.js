const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Reprend la musique en pause"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")], ephemeral: true });
    }
    queue.resume();
    await interaction.reply({ embeds: [buildStatusEmbed("success", "Musique reprise.", { icon: "▶️" })] });
  },
};
