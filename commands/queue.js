const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Affiche la file d'attente"),

  async execute(interaction) {
    const player = interaction.client.kazagumo.players.get(interaction.guildId);
    const tracks = player ? [player.queue.current, ...player.queue].filter(Boolean) : [];
    if (tracks.length === 0) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "La file d'attente est vide.")], ephemeral: true });
    }

    const list = tracks
      .slice(0, 15)
      .map((t, i) => `${i === 0 ? "En cours :" : `${i}.`} **${t.title}**`)
      .join("\n");

    await interaction.reply({
      embeds: [buildStatusEmbed("info", list, { title: `File d'attente (${tracks.length} titres)` })],
    });
  },
};
