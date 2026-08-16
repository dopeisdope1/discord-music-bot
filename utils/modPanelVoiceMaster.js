const { RoleSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { buildCard, buildSelect, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const voiceMasterStore = require("./voiceMasterStore");

const KEY = "voicemaster";

function render(guildId) {
  const cfg = voiceMasterStore.getConfig(guildId);
  const activeLabels = voiceMasterStore.ACTIONS.filter((a) => cfg.actions.includes(a.key)).map((a) => a.label);

  const container = buildCard({
    title: "Voice Master",
    description:
      "Rôles autorisés à gérer le vocal (via `&voc` ou le clic droit) **sans** leur donner les vraies permissions Discord.\n" +
      "Ces permissions-là s'appliqueraient partout et sans contrôle de hiérarchie — ici, tout passe par le bot.",
    fields: [
      { name: "Rôles", value: cfg.roles.length ? cfg.roles.map((r) => `<@&${r}>`).join(", ") : "aucun" },
      { name: "Actions autorisées", value: activeLabels.length ? activeLabels.join(", ") : "aucune" },
    ],
  });

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("modpanel:voicemaster:roles")
        .setPlaceholder("Rôles Voice Master (remplace la liste)")
        .setMinValues(0)
        .setMaxValues(25)
        .setDefaultRoles(cfg.roles)
    )
  );

  container.addActionRowComponents(
    actionRow(
      buildSelect(
        "modpanel:voicemaster:actions",
        "Actions autorisées à ces rôles",
        voiceMasterStore.ACTIONS.map((a) => ({ label: a.label, value: a.key, default: cfg.actions.includes(a.key) })),
        { min: 0, max: voiceMasterStore.ACTIONS.length }
      )
    )
  );

  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));
  return payload(container);
}

async function handle(interaction) {
  const view = interaction.customId.split(":")[2];
  const guildId = interaction.guild.id;

  if (view === "roles") {
    voiceMasterStore.setRoles(guildId, interaction.values);
    return interaction.update(render(guildId));
  }

  if (view === "actions") {
    voiceMasterStore.setActions(guildId, interaction.values);
    return interaction.update(render(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Voice Master", render, handle });

module.exports = { render };
