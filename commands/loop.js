const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Change le mode de répétition")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Mode de répétition")
        .setRequired(true)
        .addChoices(
          { name: "Désactivée", value: "0" },
          { name: "Chanson", value: "1" },
          { name: "File d'attente", value: "2" }
        )
    ),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ content: "❌ Aucune musique en cours.", ephemeral: true });
    }
    const mode = parseInt(interaction.options.getString("mode"), 10);
    queue.setRepeatMode(mode);
    const labels = ["Désactivée", "Chanson", "File d'attente"];
    await interaction.reply(`🔁 Mode de répétition : **${labels[mode]}**`);
  },
};
