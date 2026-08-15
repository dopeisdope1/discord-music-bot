const { RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { buildCard, buildSelect, appendText, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const muteStore = require("./muteStore");

const KEY = "mute";

function renderMain(guildId) {
  const cfg = muteStore.getConfig(guildId);
  const reasons = muteStore.listReasons(guildId);

  const container = buildCard({
    title: "Mute",
    description: "Configuration du système de mute",
    fields: [
      { name: "Mode", value: cfg.mode === "role" ? "rôle" : "timeout" },
      { name: "Raisons personnalisées", value: cfg.allowCustomReasons ? "autorisées" : "interdites" },
      { name: "Raisons configurées", value: String(reasons.length) },
    ],
  });

  const toggleLabel = cfg.allowCustomReasons ? "Interdire les raisons personnalisées" : "Autoriser les raisons personnalisées";

  container.addActionRowComponents(
    actionRow(
      buildSelect("modpanel:mute:actions", "Choisir une action", [
        { label: "Changer de mode", value: "mode" },
        { label: "Gérer les raisons", value: "reasons" },
        { label: toggleLabel, value: "togglereasons" },
      ])
    )
  );
  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));

  return payload(container);
}

function renderModeView(guildId) {
  const cfg = muteStore.getConfig(guildId);
  const container = buildCard({
    title: "Mode de mute",
    fields: [
      { name: "Actuel", value: cfg.mode === "role" ? "Rôle" : "Timeout Discord" },
      { name: "Rôle", value: "attribue un rôle mute" },
      { name: "Timeout", value: "utilise le système de timeout Discord (max 28j)" },
    ],
  });

  container.addActionRowComponents(
    actionRow(
      buildSelect("modpanel:mute:modepick", "Choisir un mode", [
        { label: "Rôle", value: "role", description: "Attribue un rôle mute au membre" },
        { label: "Timeout Discord", value: "timeout", description: "Utilise le timeout natif Discord (max 28j)" },
        { label: "Retour", value: "back" },
      ])
    )
  );
  return payload(container);
}

function renderReasonsView(guildId) {
  const reasons = muteStore.listReasons(guildId);
  const container = buildCard({ title: "Raisons de mute" });
  appendText(container, reasons.length ? reasons.map((r) => `• ${r}`).join("\n") : "Aucune raison configurée.");

  container.addActionRowComponents(
    actionRow(
      buildSelect("modpanel:mute:reasonactions", "Actions", [
        { label: "Ajouter une raison", value: "add" },
        { label: "Retirer une raison", value: "remove" },
        { label: "Retour", value: "back" },
      ])
    )
  );
  return payload(container);
}

function renderReasonRemovePicker(guildId) {
  const reasons = muteStore.listReasons(guildId);
  const container = buildCard({ title: "Retirer une raison" });
  const options = reasons.map((r) => ({ label: r, value: r }));
  options.push({ label: "Retour", value: "back" });
  container.addActionRowComponents(
    actionRow(buildSelect("modpanel:mute:reasonremove", reasons.length ? "Choisir une raison" : "Aucune raison", options))
  );
  return payload(container);
}

function addReasonModal() {
  const modal = new ModalBuilder().setCustomId("modpanel:mute:reasonmodal").setTitle("Ajouter une raison");
  const input = new TextInputBuilder().setCustomId("reason").setLabel("Raison").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "actions") {
    const value = interaction.values[0];
    if (value === "mode") return interaction.update(renderModeView(guildId));
    if (value === "reasons") return interaction.update(renderReasonsView(guildId));
    if (value === "togglereasons") {
      const cfg = muteStore.getConfig(guildId);
      muteStore.setAllowCustomReasons(guildId, !cfg.allowCustomReasons);
      return interaction.update(renderMain(guildId));
    }
    return;
  }

  if (view === "modepick") {
    const value = interaction.values[0];
    if (value === "back") return interaction.update(renderMain(guildId));
    if (value === "timeout") {
      muteStore.setMode(guildId, "timeout", null);
      return interaction.update(renderMain(guildId));
    }
    if (value === "role") {
      const select = new RoleSelectMenuBuilder().setCustomId("modpanel:mute:rolepick").setPlaceholder("Choisis le rôle mute").setMinValues(1).setMaxValues(1);
      return interaction.reply({ components: [actionRow(select)], ephemeral: true });
    }
    return;
  }

  if (view === "rolepick") {
    const roleId = interaction.values[0];
    muteStore.setMode(guildId, "role", roleId);
    await interaction.update({ content: `✅ Mode "rôle" activé avec <@&${roleId}>.`, components: [] });
    return;
  }

  if (view === "reasonactions") {
    const value = interaction.values[0];
    if (value === "back") return interaction.update(renderMain(guildId));
    if (value === "add") return interaction.showModal(addReasonModal());
    if (value === "remove") return interaction.update(renderReasonRemovePicker(guildId));
    return;
  }

  if (view === "reasonremove") {
    const value = interaction.values[0];
    if (value === "back") return interaction.update(renderReasonsView(guildId));
    muteStore.removeReason(guildId, value);
    return interaction.update(renderReasonsView(guildId));
  }

  if (view === "reasonmodal") {
    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (reason) muteStore.addReason(guildId, reason);
    return interaction.update(renderReasonsView(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Configuration du mute", render: renderMain, handle });

module.exports = { renderMain };
