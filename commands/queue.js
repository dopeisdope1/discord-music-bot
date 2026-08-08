const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Affiche la file d'attente"),

  async execute(interaction) {
    const queue = interaction.client.distube.getQueue(interaction.guildId);
    if (!queue || queue.songs.length === 0) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "La file d'attente est vide.")], ephemeral: true });
    }

    const list = queue.songs
      .slice(0, 15)
      .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} **${s.name}** - ${s.formattedDuration}`)
      .join("\n");

    await interaction.reply({
      embeds: [
        buildStatusEmbed("info", list, { title: `📜 File d'attente (${queue.songs.length} titres)`, icon: "" }),
      ],
    });
  },
};
