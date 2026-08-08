const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Passe à la musique suivante"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")], ephemeral: true });
    }
    try {
      const song = await queue.skip();
      await interaction.reply({ embeds: [buildStatusEmbed("success", `Passé à : **${song.name}**`, { icon: "⏭️" })] });
    } catch {
      await interaction.reply({ embeds: [buildStatusEmbed("error", "Rien à passer.")], ephemeral: true });
    }
  },
};
