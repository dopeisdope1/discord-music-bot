const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Passe à la musique suivante"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: "❌ Aucune musique en cours.", ephemeral: true });
    }
    try {
      const song = await queue.skip();
      await interaction.reply(`⏭️ Passé à : **${song.name}**`);
    } catch {
      await interaction.reply({ content: "❌ Rien à passer.", ephemeral: true });
    }
  },
};
