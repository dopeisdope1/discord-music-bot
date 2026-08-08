const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Arrête la musique et vide la file d'attente"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: "❌ Aucune musique en cours.", ephemeral: true });
    }
    queue.stop();
    await interaction.reply("⏹️ Musique arrêtée et file d'attente vidée.");
  },
};
