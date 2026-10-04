const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

// Panel "Permissions" — style Embed + ActionRows classique (pas Components
// V2), demande explicite reproduisant point par point la capture de
// référence. Fichier autonome, indépendant de utils/configPanel.js (qui
// utilise Components V2) : branché via "&examplepanel", à ne jamais confondre
// avec le vrai "&panel" (données réelles, Components V2).

// customId exacts de ce panel — utilisés par index.js pour router UNIQUEMENT
// ces interactions-là vers handlePermissionsPanelInteraction, sans toucher au
// reste du dispatch (cfg:, palierPanel, etc.).
const EXAMPLE_CUSTOM_IDS = [
  "choose_permission",
  "choose_command",
  "cooldown_prev",
  "cooldown_next",
  "choose_config",
  "configure_blocked_channels",
];

/** Construit le message (embed + composants) du panel Permissions. */
function buildPermissionsPanel({ cooldownPage = 1, cooldownTotalPages = 3 } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31) // gris sombre, même teinte que les cartes Discord natives
    .setTitle("Permissions")
    .setDescription(
      [
        "Vous pouvez configurer les permissions (1-9)",
        "",
        "**Cooldowns**",
        `Page ${cooldownPage}/${cooldownTotalPages}`,
        "",
        "**Permissions supplémentaires**",
        "Donnez un accès direct à certaines commandes",
        "",
        "**Salons bloqués**",
        "Aucun salon bloqué",
      ].join("\n")
    );

  // 1. "Choisir une permission" — niveaux 1 à 9.
  const permissionSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("choose_permission")
      .setPlaceholder("Choisir une permission")
      .addOptions(
        Array.from({ length: 9 }, (_, i) => i + 1).map((n) =>
          new StringSelectMenuOptionBuilder().setLabel(`Permission ${n}`).setValue(`permission_${n}`)
        )
      )
  );

  // 2. "Choisir une commande" (section Cooldowns) — options factices.
  const commandSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("choose_command")
      .setPlaceholder("Choisir une commande")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("option1").setValue("option1"),
        new StringSelectMenuOptionBuilder().setLabel("option2").setValue("option2"),
        new StringSelectMenuOptionBuilder().setLabel("option3").setValue("option3")
      )
  );

  // 3. Pagination Cooldowns — les SEULS vrais boutons de ce panel.
  const cooldownPager = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("cooldown_prev")
      .setLabel("←")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(cooldownPage <= 1),
    new ButtonBuilder()
      .setCustomId("cooldown_next")
      .setLabel("→")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(cooldownPage >= cooldownTotalPages)
  );

  // 4. "Choisir une configuration" (section Permissions supplémentaires).
  const configSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("choose_config")
      .setPlaceholder("Choisir une configuration")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("option1").setValue("option1"),
        new StringSelectMenuOptionBuilder().setLabel("option2").setValue("option2"),
        new StringSelectMenuOptionBuilder().setLabel("option3").setValue("option3")
      )
  );

  // 5. "Configurer les salons bloqués" (section Salons bloqués).
  const blockedChannelsSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("configure_blocked_channels")
      .setPlaceholder("Configurer les salons bloqués")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("option1").setValue("option1"),
        new StringSelectMenuOptionBuilder().setLabel("option2").setValue("option2"),
        new StringSelectMenuOptionBuilder().setLabel("option3").setValue("option3")
      )
  );

  return {
    embeds: [embed],
    components: [permissionSelect, commandSelect, cooldownPager, configSelect, blockedChannelsSelect],
  };
}

/**
 * Handler d'interaction minimal — à relier à ton routeur principal.
 * Chaque customId retrouve ici son action ; aucune logique métier réelle,
 * juste un squelette prêt à être rempli (c'est un panel d'exemple).
 */
async function handlePermissionsPanelInteraction(interaction) {
  const { customId } = interaction;

  if (interaction.isStringSelectMenu()) {
    const valeur = interaction.values[0];

    if (customId === "choose_permission") {
      return interaction.reply({ content: `Permission choisie : \`${valeur}\``, ephemeral: true });
    }
    if (customId === "choose_command") {
      return interaction.reply({ content: `Commande choisie : \`${valeur}\``, ephemeral: true });
    }
    if (customId === "choose_config") {
      return interaction.reply({ content: `Configuration choisie : \`${valeur}\``, ephemeral: true });
    }
    if (customId === "configure_blocked_channels") {
      return interaction.reply({ content: `Salon bloqué choisi : \`${valeur}\``, ephemeral: true });
    }
  }

  if (interaction.isButton()) {
    if (customId === "cooldown_prev") {
      // Exemple : recalcule la page courante (à remplacer par ton vrai state) puis réédite le panel.
      const panel = buildPermissionsPanel({ cooldownPage: 1, cooldownTotalPages: 3 });
      return interaction.update(panel);
    }
    if (customId === "cooldown_next") {
      const panel = buildPermissionsPanel({ cooldownPage: 2, cooldownTotalPages: 3 });
      return interaction.update(panel);
    }
  }

  return undefined;
}

module.exports = { buildPermissionsPanel, handlePermissionsPanelInteraction, EXAMPLE_CUSTOM_IDS };
