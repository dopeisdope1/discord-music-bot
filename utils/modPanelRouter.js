const { registerHandler } = require("./modInteractionRegistry");
const botAdminsStore = require("./botAdminsStore");
const { saveGuildConfig } = require("./configChannel");

// Ordre des rubriques : les 6 du projet zinki + 2 propres à ce bot
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

const DEFAULT_RUBRIQUE = RUBRIQUES[0].key;

const panels = new Map();

function registerPanel(mod) {
  panels.set(mod.key, mod);
}

// `&panel` ouvre directement la première rubrique (comme l'ancien panel qui
// s'ouvrait sur "Préfixes") — pas d'écran "choisis une rubrique" séparé, la
// barre de boutons en bas de chaque page permet de changer de rubrique
// directement.
function renderRoot(guildId) {
  const panel = panels.get(DEFAULT_RUBRIQUE);
  return panel.render(guildId);
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
