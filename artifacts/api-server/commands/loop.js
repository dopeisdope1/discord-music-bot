const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { LOOP_LABELS } = require("../utils/nowPlayingPanel");
const { requirePlayerControlInteraction } = require("../utils/playerControl");

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
          { name: "Désactivée", value: "none" },
          { name: "Chanson", value: "track" },
          { name: "File d'attente", value: "queue" }
        )
    ),

  async execute(interaction) {
    const player = interaction.client.kazagumo.players.get(interaction.guildId);
    if (!player) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")], ephemeral: true });
    }
    if (!(await requirePlayerControlInteraction(interaction))) return;
    const mode = interaction.options.getString("mode");
    player.setLoop(mode);
    await interaction.reply({
      embeds: [buildStatusEmbed("success", `Mode de répétition : **${LOOP_LABELS[mode]}**`)],
    });
  },
};
