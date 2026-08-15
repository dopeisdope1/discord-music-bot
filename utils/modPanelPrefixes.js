const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { buildCard, buildSelect, actionRow, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const { getPrefixes, setPrefix } = require("./prefixStore");

const KEY = "prefixes";

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
    actionRow(
      buildSelect("modpanel:prefixes:pick", "Changer un préfixe", [
        { label: "Préfixe musique", value: "main" },
        { label: "Préfixe modération", value: "musicMod" },
        panelRouter.BACK_OPTION,
      ])
    )
  );
  return payload(container);
}

function modal(type) {
  const label = type === "main" ? "Nouveau préfixe musique" : "Nouveau préfixe modération";
  const m = new ModalBuilder().setCustomId(`modpanel:prefixes:modal:${type}`).setTitle("Changer un préfixe");
  const input = new TextInputBuilder().setCustomId("value").setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5);
  m.addComponents(new ActionRowBuilder().addComponents(input));
  return m;
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "pick") {
    const value = interaction.values[0];
    if (value === "back") return interaction.update(panelRouter.renderRoot());
    return interaction.showModal(modal(value));
  }

  if (view === "modal") {
    const type = parts[3];
    const value = interaction.fields.getTextInputValue("value").trim();
    if (value) setPrefix(guildId, type, value);
    return interaction.update(render(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Préfixes", render, handle });

module.exports = { render };
