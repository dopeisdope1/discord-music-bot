const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { fetchAllMembers, memberFetchErrorMessage } = require("./guildMembers");

const PANEL_TIMEOUT_MS = 10 * 60_000;

function buildNivPanel(roleId, statusText) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Niv\n> Choisis un rôle pour voir les membres qui l'ont mais ne sont pas en vocal.\n\n" +
        `**Rôle actuel :** ${roleId ? `<@&${roleId}>` : "*aucun*"}` +
        (statusText ? `\n\n${statusText}` : "")
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId("niv_role_select").setPlaceholder("Sélectionner un rôle").setMinValues(1).setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("niv_send").setLabel("🔄 Envoyer la liste").setStyle(ButtonStyle.Secondary).setDisabled(!roleId)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * `=niv` : choisis un rôle, liste qui l'a mais n'est actuellement dans aucun
 * salon vocal — pratique pour repérer qui devrait être en vocal (staff de
 * garde, etc.) et ne l'est pas. Pas de vérification de permission
 * particulière au-delà de celles déjà en place pour les commandes `=` —
 * simple outil de lecture, aucune action destructrice.
 * @param {import('discord.js').Message} message
 */
async function handleNivCommand(message) {
  let selectedRoleId = null;
  const panelMessage = await message.reply(buildNivPanel(null));
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isRoleSelectMenu() && i.customId === "niv_role_select") {
        selectedRoleId = i.values[0];
        await i.update(buildNivPanel(selectedRoleId));
        return;
      }

      if (i.isButton() && i.customId === "niv_send") {
        if (!selectedRoleId) return;
        await i.deferUpdate();

        let members;
        try {
          members = await fetchAllMembers(message.guild);
        } catch (err) {
          console.error(err);
          await i.editReply(buildNivPanel(selectedRoleId, memberFetchErrorMessage(err) || "Impossible de récupérer la liste des membres, réessaie."));
          return;
        }

        const notInVoice = [...members.values()].filter((m) => m.roles.cache.has(selectedRoleId) && !m.voice.channelId);
        const list = notInVoice.length
          ? notInVoice
              .slice(0, 40)
              .map((m) => `<@${m.id}>`)
              .join(", ") + (notInVoice.length > 40 ? `\n*(+${notInVoice.length - 40} autres)*` : "")
          : "*Tout le monde avec ce rôle est en vocal (ou personne ne l'a).*";

        await i.editReply(buildNivPanel(selectedRoleId, `**${notInVoice.length} membre(s) hors vocal :**\n${list}`));
        return;
      }
    } catch (err) {
      console.error("[nivPanel] Erreur :", err);
    }
  });

  collector.on("end", () => {
    panelMessage.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { handleNivCommand };
