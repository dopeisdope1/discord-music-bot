const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Affiche la file d'attente"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue || queue.songs.length === 0) {
      return interaction.reply({ content: "❌ La file d'attente est vide.", ephemeral: true });
    }

    const list = queue.songs
      .slice(0, 15)
      .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} **${s.name}** - ${s.formattedDuration}`)
      .join("\n");

    await interaction.reply(`📜 **File d'attente (${queue.songs.length} titres) :**\n${list}`);
  },
};
