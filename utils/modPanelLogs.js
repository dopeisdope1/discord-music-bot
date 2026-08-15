const { ChannelSelectMenuBuilder, ChannelType } = require("discord.js");
const { buildCard, buildSelect, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const { getLogChannelId, setLogChannel, LOG_CATEGORIES } = require("./logStore");

const KEY = "logs";

// Seules les catégories que CE bot écrit réellement — "securite"/"blacklist"
// appartiennent au bot Sécurité (voir utils/logStore.js), pas exposées ici.
const EXPOSED_CATEGORIES = ["moderation", "salon", "roles", "raid", "messages", "joins", "leaves"];

function render(guildId) {
  const lines = EXPOSED_CATEGORIES.map((key) => {
    const meta = LOG_CATEGORIES[key];
    const channelId = getLogChannelId(guildId, key);
    return `${channelId ? "✅" : "❌"} **${meta.label}** ${channelId ? `— <#${channelId}>` : ""}`;
  });

  const container = buildCard({ title: "Configurer les logs", description: lines.join("\n") });

  const options = EXPOSED_CATEGORIES.map((key) => ({ label: LOG_CATEGORIES[key].label, value: key }));

  container.addActionRowComponents(actionRow(buildSelect("modpanel:logs:pick", "Choisir un type de log", options)));
  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));
  return payload(container);
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];

  if (view === "pick") {
    const value = interaction.values[0];
    const label = LOG_CATEGORIES[value]?.label || value;
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`modpanel:logs:setchannel:${value}`)
      .setPlaceholder(`Choisis le salon pour "${label}"`)
      .addChannelTypes(ChannelType.GuildText);
    return interaction.reply({
      content: `📋 Sélectionne le salon pour les logs **${label}** :`,
      components: [actionRow(select)],
      ephemeral: true,
    });
  }

  if (view === "setchannel") {
    const category = parts[3];
    const channelId = interaction.values[0];
    setLogChannel(interaction.guild.id, category, channelId);
    await interaction.update({ content: `✅ Salon de logs mis à jour : <#${channelId}>.`, components: [] });
  }
}

panelRouter.registerPanel({ key: KEY, label: "Configurer les logs", render, handle });

module.exports = { render };
