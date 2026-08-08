const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Reprend la musique en pause"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: "❌ Aucune musique en cours.", ephemeral: true });
    }
    queue.resume();
    await interaction.reply("▶️ Musique reprise.");
  },
};
