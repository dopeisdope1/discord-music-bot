const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const { getLogChannels, setLogChannel, LOG_CATEGORIES } = require("./logStore");

const PANEL_TIMEOUT_MS = 10 * 60_000;
const MAX_PREFIX_LENGTH = 5;

const TYPE_LABELS = {
  main: "musique",
  dash: "membres/modération",
};

function buildPrefixPanel(guildId) {
  const { main, dash } = getPrefixes(guildId);
  const logChannels = getLogChannels(guildId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Préfixes du bot\n> Musique : \`${main}\`\n> Membres/modération (dont \`.ban\`/\`.unban\`) : \`${dash}\``
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prefix_edit:main").setLabel("Changer préfixe musique").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prefix_edit:dash").setLabel("Changer préfixe membres/modération").setStyle(ButtonStyle.Secondary)
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Logs\n> Choisis un salon par catégorie ci-dessous pour y recevoir les logs correspondants.\n" +
        Object.values(LOG_CATEGORIES)
          .map((cat) => {
            const channelId = logChannels[cat.key];
            return `**${cat.label}** (${cat.description}) — ${channelId ? `<#${channelId}>` : "*non configuré*"}`;
          })
          .join("\n")
    )
  );

  for (const cat of Object.values(LOG_CATEGORIES)) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`log_channel:${cat.key}`)
          .setPlaceholder(`${cat.label} — choisir un salon`)
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1)
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildPrefixModal(type, current) {
  return new ModalBuilder()
    .setCustomId(`prefix_modal:${type}`)
    .setTitle(`Préfixe ${TYPE_LABELS[type]}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(`Nouveau préfixe (${TYPE_LABELS[type]})`)
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(MAX_PREFIX_LENGTH)
          .setValue(current)
          .setRequired(true)
      )
    );
}

/**
 * Ouvre le panel de gestion des préfixes et des salons de logs (`.panel`,
 * réservé aux administrateurs — la vérification se fait avant l'appel de
 * cette fonction). Deux boutons ouvrent chacun une modale pour changer le
 * préfixe musique ou membres/mod ; trois menus déroulants (recherche native
 * Discord) choisissent le salon de logs par catégorie. Tout est persisté par
 * serveur via utils/prefixStore.js et utils/logStore.js.
 * @param {import('discord.js').Message} message
 */
async function handlePrefixPanel(message) {
  const guildId = message.guild.id;
  const panelMessage = await message.reply(buildPrefixPanel(guildId));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    if (i.user.id !== message.author.id) {
      await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
      return;
    }

    if (i.isChannelSelectMenu() && i.customId.startsWith("log_channel:")) {
      const category = i.customId.split(":")[1];
      const channelId = i.values[0];
      setLogChannel(guildId, category, channelId);
      await i.update(buildPrefixPanel(guildId));
      return;
    }

    if (!i.isButton() || !i.customId.startsWith("prefix_edit:")) return;

    const type = i.customId.split(":")[1]; // "main" | "dash"
    const current = getPrefixes(guildId)[type];
    await i.showModal(buildPrefixModal(type, current));

    let submitted;
    try {
      submitted = await i.awaitModalSubmit({
        time: PANEL_TIMEOUT_MS,
        filter: (m) => m.customId === `prefix_modal:${type}` && m.user.id === message.author.id,
      });
    } catch {
      return; // pas de soumission dans les temps
    }

    const raw = submitted.fields.getTextInputValue("value").trim();
    const prefixes = getPrefixes(guildId);
    const otherType = type === "main" ? "dash" : "main";
    const other = prefixes[otherType];

    if (!raw || /\s/.test(raw) || raw.length > MAX_PREFIX_LENGTH) {
      await submitted.reply({
        content: "Préfixe invalide : pas d'espace, 1 à 5 caractères.",
        ephemeral: true,
      });
      return;
    }
    if (raw === other || raw.startsWith(other) || other.startsWith(raw)) {
      await submitted.reply({
        content: `Ce préfixe entre en conflit avec le préfixe ${TYPE_LABELS[otherType]} actuel (\`${other}\`), choisis-en un autre.`,
        ephemeral: true,
      });
      return;
    }

    setPrefix(guildId, type, raw);
    await submitted.update(buildPrefixPanel(guildId));
  });
}

module.exports = { handlePrefixPanel };
