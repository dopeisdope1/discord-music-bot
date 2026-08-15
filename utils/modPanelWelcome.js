const { ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { buildCard, buildSelect, appendText, actionRow, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const welcomeStore = require("./welcomeStore");

const KEY = "welcome";

function render(guildId) {
  const channelId = welcomeStore.getWelcomeChannel(guildId);
  const messages = welcomeStore.getWelcomeMessages(guildId);
  const delayMs = welcomeStore.getWelcomeDeleteDelay(guildId);

  const container = buildCard({
    title: "Bienvenue",
    fields: [
      { name: "Salon", value: channelId ? `<#${channelId}>` : "non configuré" },
      { name: "Messages personnalisés", value: String(messages.length) },
      { name: "Suppression auto", value: delayMs > 0 ? `${Math.round(delayMs / 1000)}s` : "jamais" },
    ],
  });

  container.addActionRowComponents(
    actionRow(
      buildSelect("modpanel:welcome:actions", "Actions", [
        { label: "Définir le salon", value: "setchannel" },
        { label: "Ajouter un message", value: "addmessage" },
        { label: "Retirer un message", value: "removemessage" },
        { label: "Définir le délai de suppression", value: "setdelay" },
        panelRouter.BACK_OPTION,
      ])
    )
  );
  return payload(container);
}

function renderRemovePicker(guildId) {
  const messages = welcomeStore.getWelcomeMessages(guildId);
  const container = buildCard({ title: "Retirer un message de bienvenue" });
  appendText(container, messages.length ? messages.map((m, i) => `${i + 1}. ${m}`).join("\n") : "Aucun message personnalisé.");

  const options = messages.map((m, i) => ({ label: `#${i + 1} — ${m.slice(0, 80)}`, value: String(i + 1) }));
  options.push({ label: "Retour", value: "back" });
  container.addActionRowComponents(
    actionRow(buildSelect("modpanel:welcome:removepick", messages.length ? "Choisir un message" : "Aucun message", options))
  );
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

function delayModal(guildId) {
  const current = welcomeStore.getWelcomeDeleteDelay(guildId);
  const modal = new ModalBuilder().setCustomId("modpanel:welcome:delaymodal").setTitle("Délai de suppression");
  const input = new TextInputBuilder()
    .setCustomId("seconds")
    .setLabel("Secondes avant suppression (0 = jamais)")
    .setStyle(TextInputStyle.Short)
    .setValue(String(Math.round(current / 1000)))
    .setRequired(true)
    .setMaxLength(6);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "actions") {
    const value = interaction.values[0];
    if (value === "back") return interaction.update(panelRouter.renderRoot());

    if (value === "setchannel") {
      const select = new ChannelSelectMenuBuilder()
        .setCustomId("modpanel:welcome:setchannel")
        .setPlaceholder("Choisis le salon de bienvenue")
        .addChannelTypes(ChannelType.GuildText);
      return interaction.reply({ components: [actionRow(select)], ephemeral: true });
    }

    if (value === "addmessage") return interaction.showModal(addMessageModal());
    if (value === "removemessage") return interaction.update(renderRemovePicker(guildId));
    if (value === "setdelay") return interaction.showModal(delayModal(guildId));
    return;
  }

  if (view === "setchannel") {
    const channelId = interaction.values[0];
    welcomeStore.setWelcomeChannel(guildId, channelId);
    await interaction.update({ content: `✅ Salon de bienvenue défini sur <#${channelId}>.`, components: [] });
    return;
  }

  if (view === "removepick") {
    const value = interaction.values[0];
    if (value === "back") return interaction.update(render(guildId));
    welcomeStore.removeWelcomeMessage(guildId, Number(value));
    return interaction.update(render(guildId));
  }

  if (view === "addmodal") {
    const text = interaction.fields.getTextInputValue("text").trim();
    if (text) welcomeStore.addWelcomeMessage(guildId, text);
    return interaction.update(render(guildId));
  }

  if (view === "delaymodal") {
    const raw = interaction.fields.getTextInputValue("seconds").trim();
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) welcomeStore.setWelcomeDeleteDelay(guildId, seconds * 1000);
    return interaction.update(render(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Bienvenue", render, handle });

module.exports = { render };
