const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête la musique et vide la file d'attente"),

  async execute(interaction) {
    const player = interaction.client.kazagumo.players.get(interaction.guildId);
    if (!player) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")], ephemeral: true });
    }
    interaction.client.nowPlayingMessages.delete(interaction.guildId);
    player.destroy();
    await interaction.reply({
      embeds: [buildStatusEmbed("success", "Musique arrêtée et file d'attente vidée.", { icon: "⏹️" })],
    });
  },
};
