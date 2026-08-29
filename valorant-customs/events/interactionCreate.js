/**
 * Routage des interactions : commandes slash, boutons, menus, modales.
 *
 * Toutes les erreurs sont attrapées ici pour qu'un joueur ne se retrouve
 * jamais devant un « L'application ne répond pas » silencieux.
 */

const { Events, MessageFlags } = require("discord.js");

const { errorEmbed } = require("../utils/embeds");
const { handleComponent, handleProfileModal } = require("../utils/matchActions");
const { handlePanelComponent, handlePanelModal } = require("../utils/panel");

/** Répond (ou édite) sans jamais lever une seconde erreur. */
async function safeError(interaction, message) {
  const payload = { embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred) await interaction.editReply({ embeds: payload.embeds, components: [] });
    else if (interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch {
    // L'interaction a expiré (3 s) : rien à faire de plus.
  }
}

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction) {
    try {
      // ---- Commandes slash ----
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return safeError(interaction, "Cette commande n'existe plus. Relance `npm run deploy`.");
        return await command.execute(interaction);
      }

      // ---- Boutons et menus déroulants (string, user, salon) ----
      if (interaction.isButton() || interaction.isAnySelectMenu()) {
        // Le panneau (`vp:`) d'abord, les parties (`vc:`) ensuite : chaque
        // routeur ignore poliment ce qui ne le concerne pas.
        const handled = (await handlePanelComponent(interaction)) || (await handleComponent(interaction));
        if (!handled) return safeError(interaction, "Ce bouton n'est plus pris en charge.");
        return;
      }

      // ---- Modales ----
      if (interaction.isModalSubmit()) {
        const handled = (await handlePanelModal(interaction)) || (await handleProfileModal(interaction));
        if (!handled) return safeError(interaction, "Ce formulaire n'est plus pris en charge.");
        return;
      }
    } catch (error) {
      console.error(`[interaction] Erreur sur ${interaction.commandName || interaction.customId} :`, error);
      await safeError(interaction, "Une erreur inattendue est survenue. L'incident a été enregistré côté serveur.");
    }
  },
};
