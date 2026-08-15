const {
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { buildCard, buildSelect, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const welcomeStore = require("./welcomeStore");

const KEY = "welcome";

const DELETE_DELAYS = [
  { label: "Jamais (par défaut)", value: 0 },
  { label: "5 secondes", value: 5_000 },
  { label: "10 secondes", value: 10_000 },
  { label: "30 secondes", value: 30_000 },
  { label: "1 minute", value: 60_000 },
  { label: "5 minutes", value: 300_000 },
];

// Tout sur une seule page (sélecteur de salon, délai, ajout, retrait) — même
// disposition que l'ancien &panel > Bienvenue de ce bot, pas de sous-menu "Actions".
function render(guildId) {
  const channelId = welcomeStore.getWelcomeChannel(guildId);
  const messages = welcomeStore.getWelcomeMessages(guildId);
  const delayMs = welcomeStore.getWelcomeDeleteDelay(guildId);

  const container = buildCard({
    title: "Bienvenue",
    description:
      "**Messages** (un est tiré au hasard à chaque arrivée)\n" +
      (messages.length ? messages.map((m, i) => `${i + 1}. ${m}`).join("\n") : "*Aucun message personnalisé — les messages par défaut sont utilisés.*"),
    fields: [
      { name: "Salon", value: channelId ? `<#${channelId}>` : "non configuré" },
      { name: "Suppression auto", value: DELETE_DELAYS.find((d) => d.value === delayMs)?.label || `${delayMs} ms` },
    ],
  });

  container.addActionRowComponents(
    actionRow(
      new ChannelSelectMenuBuilder()
        .setCustomId("modpanel:welcome:setchannel")
        .setPlaceholder("Envoyer le message de bienvenue à ce salon")
        .addChannelTypes(ChannelType.GuildText)
    )
  );

  container.addActionRowComponents(
    actionRow(
      buildSelect(
        "modpanel:welcome:setdelay",
        "Supprimer le message après un certain temps",
        DELETE_DELAYS.map((d) => ({ label: d.label, value: String(d.value), default: d.value === delayMs }))
      )
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("modpanel:welcome:addbutton").setLabel("Ajouter un message").setStyle(ButtonStyle.Secondary)
    )
  );

  if (messages.length) {
    container.addActionRowComponents(
      actionRow(
        buildSelect(
          "modpanel:welcome:removepick",
          "Retirer un message",
          messages.slice(0, 25).map((m, i) => ({ label: `${i + 1}. ${m}`.slice(0, 100), value: String(i + 1) }))
        )
      )
    );
  }

  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));
  return payload(container);
}

function addMessageModal() {
  const modal = new ModalBuilder().setCustomId("modpanel:welcome:addmodal").setTitle("Ajouter un message de bienvenue");
  const input = new TextInputBuilder()
    .setCustomId("text")
    .setLabel("Texte (après la mention du membre)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "setchannel") {
    const channelId = interaction.values[0];
    welcomeStore.setWelcomeChannel(guildId, channelId);
    return interaction.update(render(guildId));
  }

  if (view === "setdelay") {
    const ms = Number(interaction.values[0]);
    welcomeStore.setWelcomeDeleteDelay(guildId, ms);
    return interaction.update(render(guildId));
  }

  if (view === "addbutton") return interaction.showModal(addMessageModal());

  if (view === "removepick") {
    welcomeStore.removeWelcomeMessage(guildId, Number(interaction.values[0]));
    return interaction.update(render(guildId));
  }

  if (view === "addmodal") {
    const text = interaction.fields.getTextInputValue("text").trim();
    if (text) welcomeStore.addWelcomeMessage(guildId, text);
    return interaction.update(render(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Bienvenue", render, handle });

module.exports = { render };
