const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Met la musique en pause"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: "❌ Aucune musique en cours.", ephemeral: true });
    }
    queue.pause();
    await interaction.reply("⏸️ Musique en pause.");
  },
};
