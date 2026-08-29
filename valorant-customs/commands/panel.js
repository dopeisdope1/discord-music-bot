/**
 * /panel — panneau de contrôle du bot.
 *
 * Visible uniquement par le root (toi) et les propriétaires que tu nommes.
 * La réponse est éphémère : même lancé dans un salon public, personne d'autre
 * ne voit le panneau.
 */

const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require("discord.js");

const access = require("../utils/access");
const { errorEmbed } = require("../utils/embeds");
const { buildHome } = require("../utils/panel");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Panneau de contrôle du bot (propriétaires uniquement)")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!access.canOpenPanel(interaction.user.id)) {
      // Message volontairement neutre : inutile d'annoncer qui est propriétaire.
      return interaction.reply({
        embeds: [errorEmbed("Cette commande est réservée aux propriétaires du bot.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      ...buildHome(interaction.user.id, interaction.guildId),
      flags: MessageFlags.Ephemeral,
    });
  },
};
