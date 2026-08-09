const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { stopNowPlayingTracking } = require("../utils/musicPlayer");
const { requirePlayerControlInteraction, clearPlayerControl } = require("../utils/playerControl");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête la musique et vide la file d'attente"),

  async execute(interaction) {
    const player = interaction.client.kazagumo.players.get(interaction.guildId);
    if (!player) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")], ephemeral: true });
    }
    if (!(await requirePlayerControlInteraction(interaction))) return;
    stopNowPlayingTracking(interaction.client, interaction.guildId);
    clearPlayerControl(interaction.client, interaction.guildId);
    player.destroy();
    await interaction.reply({
      embeds: [buildStatusEmbed("success", "Musique arrêtée et file d'attente vidée.")],
    });
  },
};
