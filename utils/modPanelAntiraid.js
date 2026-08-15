const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { buildCard, buildSelect, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const antiraidConfigStore = require("./antiraidConfigStore");

const KEY = "antiraid";

const TIERS = [
  { value: "warn", label: "WARN", description: "Log + alerte staff, aucune friction" },
  { value: "throttle", label: "THROTTLE", description: "Confirmation obligatoire avant exécution" },
  { value: "lock", label: "LOCK", description: "Lockdown @everyone (Send Messages) le temps de l'incident" },
];

function render(guildId) {
  const cfg = antiraidConfigStore.getConfig(guildId);
  const activeTiers = TIERS.filter((t) => cfg[`${t.value}Enabled`]).map((t) => t.label);

  const container = buildCard({
    title: "Anti-raid",
    description:
      "Détecteur d'anomalies (EWMA + z-score) par membre et par serveur, sur les commandes configurables uniquement\n" +
      "Si un palier déclenché est désactivé, il retombe sur le palier inférieur actif (sinon rien)",
    fields: [
      { name: "Paliers actifs", value: activeTiers.length ? activeTiers.join(", ") : "aucun" },
      { name: "Seuils (z-score)", value: `WARN ≥ ${cfg.warnThreshold} · THROTTLE ≥ ${cfg.throttleThreshold} · LOCK ≥ ${cfg.lockThreshold}` },
    ],
  });

  container.addActionRowComponents(
    actionRow(
      buildSelect(
        "modpanel:antiraid:tiers",
        "WARN  THROTTLE  LOCK",
        TIERS.map((t) => ({ ...t, default: Boolean(cfg[`${t.value}Enabled`]) })),
        { min: 0, max: TIERS.length }
      )
    )
  );

  container.addActionRowComponents(
    actionRow(
      buildSelect("modpanel:antiraid:actions", "Actions", [{ label: "Configurer les seuils", value: "thresholds" }])
    )
  );
  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));

  return payload(container);
}

function thresholdsModal(guildId) {
  const cfg = antiraidConfigStore.getConfig(guildId);
  const modal = new ModalBuilder().setCustomId("modpanel:antiraid:thresholdsmodal").setTitle("Configurer les seuils");
  const mk = (id, label, value) =>
    new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setValue(String(value)).setRequired(true).setMaxLength(6);
  modal.addComponents(
    new ActionRowBuilder().addComponents(mk("warn", "Seuil WARN (z-score)", cfg.warnThreshold)),
    new ActionRowBuilder().addComponents(mk("throttle", "Seuil THROTTLE (z-score)", cfg.throttleThreshold)),
    new ActionRowBuilder().addComponents(mk("lock", "Seuil LOCK (z-score)", cfg.lockThreshold))
  );
  return modal;
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "tiers") {
    const enabled = new Set(interaction.values);
    for (const tier of TIERS) antiraidConfigStore.setTierEnabled(guildId, tier.value, enabled.has(tier.value));
    return interaction.update(render(guildId));
  }

  if (view === "actions") {
    const value = interaction.values[0];
    if (value === "thresholds") return interaction.showModal(thresholdsModal(guildId));
    return;
  }

  if (view === "thresholdsmodal") {
    const warn = Number(interaction.fields.getTextInputValue("warn"));
    const throttle = Number(interaction.fields.getTextInputValue("throttle"));
    const lock = Number(interaction.fields.getTextInputValue("lock"));
    if ([warn, throttle, lock].every((n) => Number.isFinite(n) && n > 0)) {
      antiraidConfigStore.setThresholds(guildId, { warn, throttle, lock });
    }
    return interaction.update(render(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Anti-raid", render, handle });

module.exports = { render };
