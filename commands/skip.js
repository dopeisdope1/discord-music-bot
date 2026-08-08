const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Passe à la musique suivante"),

  async execute(interaction) {
    const player = interaction.client.kazagumo.players.get(interaction.guildId);
    if (!player || !player.queue.current) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Rien à passer.")], ephemeral: true });
    }
    player.skip();
    await interaction.reply({ embeds: [buildStatusEmbed("success", "Musique passée.", { icon: "⏭️" })] });
  },
};
