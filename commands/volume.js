const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Change le volume de lecture")
    .addIntegerOption((option) =>
      option
        .setName("niveau")
        .setDescription("Volume entre 0 et 150")
        .setMinValue(0)
        .setMaxValue(150)
        .setRequired(true)
    ),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: "❌ Aucune musique en cours.", ephemeral: true });
    }
    const niveau = interaction.options.getInteger("niveau");
    queue.setVolume(niveau);
    await interaction.reply(`🔊 Volume réglé sur **${niveau}%**.`);
  },
};
