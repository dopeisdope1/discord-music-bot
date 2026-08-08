const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { setPlayerPaused } = require("../utils/musicPlayer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Met la musique en pause"),

  async execute(interaction) {
    const player = interaction.client.kazagumo.players.get(interaction.guildId);
    if (!player) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")], ephemeral: true });
    }
    setPlayerPaused(player, true);
    await interaction.reply({ embeds: [buildStatusEmbed("success", "Musique en pause.")] });
  },
};
