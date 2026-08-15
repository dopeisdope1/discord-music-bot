const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildCard, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const { getPrefixes, setPrefix } = require("./prefixStore");

const KEY = "prefixes";
const TYPE_LABELS = { main: "musique", musicMod: "modération" };

// Boutons directs plutôt qu'un menu déroulant — même présentation que
// l'ancien &panel > Préfixes de ce bot.
function render(guildId) {
  const prefixes = getPrefixes(guildId);
  const container = buildCard({
    title: "Préfixes",
    fields: [
      { name: "Musique", value: `\`${prefixes.main}\`` },
      { name: "Modération", value: `\`${prefixes.musicMod}\`` },
    ],
  });

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      Object.keys(TYPE_LABELS).map((type) =>
        new ButtonBuilder()
          .setCustomId(`modpanel:prefixes:edit:${type}`)
          .setLabel(`Changer préfixe ${TYPE_LABELS[type]}`)
          .setStyle(ButtonStyle.Secondary)
      )
    )
  );
  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));
  return payload(container);
}

function modal(type, current) {
  const label = `Nouveau préfixe ${TYPE_LABELS[type]}`;
  const m = new ModalBuilder().setCustomId(`modpanel:prefixes:modal:${type}`).setTitle("Changer un préfixe");
  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setValue(current || "")
    .setRequired(true)
    .setMaxLength(5);
  m.addComponents(new ActionRowBuilder().addComponents(input));
  return m;
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "edit") {
    const type = parts[3];
    return interaction.showModal(modal(type, getPrefixes(guildId)[type]));
  }

  if (view === "modal") {
    const type = parts[3];
    const raw = interaction.fields.getTextInputValue("value").trim();
    const prefixes = getPrefixes(guildId);

    if (!raw || /\s/.test(raw) || raw.length > 5) {
      await interaction.reply({ content: "Préfixe invalide : pas d'espace, 1 à 5 caractères.", ephemeral: true });
      return;
    }

    // Un seul préfixe par bot à la fois — évite qu'un message tape dans deux
    // dispatchers différents si les préfixes se chevauchent.
    const otherType = type === "main" ? "musicMod" : "main";
    const other = prefixes[otherType];
    if (raw === other || raw.startsWith(other) || other.startsWith(raw)) {
      await interaction.reply({
        content: `Ce préfixe entre en conflit avec le préfixe ${TYPE_LABELS[otherType]} actuel (\`${other}\`), choisis-en un autre.`,
        ephemeral: true,
      });
      return;
    }

    setPrefix(guildId, type, raw);
    return interaction.update(render(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Préfixes", render, handle });

module.exports = { render };
