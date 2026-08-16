const { buildCard, buildNavButtons, payload } = require("./panelComponents");
const { registerHandler } = require("./modInteractionRegistry");
const botAdminsStore = require("./botAdminsStore");
const { saveGuildConfig } = require("./configChannel");

// Ordre des rubriques (voir buildNavButtons pour la barre de navigation).
// (Préfixes/Bienvenue, portées par l'ancien &panel). Même ordre utilisé pour
// la barre de boutons de navigation (voir utils/panelComponents.js#buildNavButtons).
const RUBRIQUES = [
  { key: "permissions", label: "Gérer les permissions" },
  { key: "logs", label: "Configurer les logs" },
  { key: "blacklist", label: "Blacklist des salons" },
  { key: "mute", label: "Configuration du mute" },
  { key: "addrole", label: "Config addrole / delrole" },
  { key: "antiraid", label: "Anti-raid" },
  { key: "prefixes", label: "Préfixes" },
  { key: "welcome", label: "Bienvenue" },
];

const panels = new Map();

function registerPanel(mod) {
  panels.set(mod.key, mod);
}

// Écran d'accueil "Panel de configuration" — aucune rubrique n'est mise en
// avant (currentKey = null), la barre de boutons sert juste à en choisir une.
function renderRoot() {
  const container = buildCard({
    title: "Panel de configuration",
    description: "Choisissez une rubrique à configurer",
  });
  container.addActionRowComponents(...buildNavButtons(RUBRIQUES, null));
  return payload(container);
}

async function dispatch(interaction) {
  if (!botAdminsStore.isSysOrAbove(interaction.user.id)) {
    await interaction.reply({ content: "❌ Réservé à la hiérarchie sys.", ephemeral: true });
    return;
  }

  const [, segment] = interaction.customId.split(":");

  if (segment === "navto") {
    const rubrique = interaction.customId.split(":")[2];
    const panel = panels.get(rubrique);
    if (!panel) return;
    await interaction.update(await panel.render(interaction.guild.id));
  } else {
    const panel = panels.get(segment);
    if (!panel) return;
    await panel.handle(interaction);
  }

  // Toute interaction de panel peut avoir modifié une config par serveur —
  // on sauvegarde systématiquement plutôt que d'essayer de suivre precisément
  // quelle action mute quoi (voir utils/configChannel.js : l'écriture est
  // idempotente et couvre toujours l'état complet, donc pas de risque à
  // sauvegarder après une simple navigation).
  await saveGuildConfig(interaction.guild, ["permissions"]).catch((err) =>
    console.warn("[modpanel] échec de la sauvegarde de config :", err.message)
  );
}

registerHandler("modpanel", dispatch);

module.exports = { RUBRIQUES, renderRoot, registerPanel };
