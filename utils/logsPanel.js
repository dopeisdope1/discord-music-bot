const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const { getLogChannels, setLogChannel, LOG_CATEGORIES } = require("./logStore");
const { getPrefixes } = require("./prefixStore");
const { saveGuildConfig, waitForHydration } = require("./configChannel");
const { isOwner } = require("./antiNukeStore");
const { buildStatusEmbed } = require("./statusEmbed");

const PANEL_TIMEOUT_MS = 10 * 60_000;

// Deux lignes fixes (sélection de catégorie, puis salon pour la catégorie
// choisie) plutôt qu'une ligne par catégorie : Discord limite un message à 5
// ActionRow, et LOG_CATEGORIES (voir utils/logStore.js) en compte désormais
// 10 — une ligne par catégorie ne tiendrait plus.
function buildLogsPage(guildId, selectedCategory) {
  const logChannels = getLogChannels(guildId);
  const { dash } = getPrefixes(guildId);
  const categories = Object.values(LOG_CATEGORIES);
  const active = categories.find((c) => c.key === selectedCategory) || categories[0];

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Logs\n> Choisis une catégorie, puis le salon où en recevoir les logs.\n" +
        categories
          .map((cat) => {
            const channelId = logChannels[cat.key];
            // cat.description écrit ses commandes avec "." comme préfixe
            // générique (voir utils/logStore.js) — remplacé ici par le vrai
            // préfixe de modération configuré sur ce serveur.
            const description = cat.description.replace(/`\./g, `\`${dash}`);
            return `**${cat.label}** (${description}) — ${channelId ? `<#${channelId}>` : "*non configuré*"}`;
          })
          .join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("log_category")
        .setPlaceholder("Catégorie à configurer")
        .addOptions(
          categories.map((cat) => ({
            label: cat.label,
            value: cat.key,
            default: cat.key === active.key,
          }))
        )
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`log_channel:${active.key}`)
        .setPlaceholder(`${active.label} — choisir un salon`)
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * `=logs` (bot Logs, réservé aux owners anti-nuke — voir `=owner`) : choisit
 * le salon de destination pour chaque catégorie de logs. Les messages sont
 * ensuite postés par le bot concerné (Gestion pour "moderation"/"salon"/
 * "roles", Security pour "securite"/"blacklist", ce bot-ci pour le reste —
 * voir utils/actionLogger.js), la config est partagée entre tous les bots
 * via le salon Discord "zinki-config" (utils/configChannel.js).
 * @param {import('discord.js').Message} message
 */
async function handleLogsCommand(message) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke de ce serveur (voir `=owner`).")] });
  }

  await waitForHydration(message.guildId);
  let selectedCategory = Object.keys(LOG_CATEGORIES)[0];
  const panelMessage = await message.reply(buildLogsPage(message.guildId, selectedCategory));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "log_category") {
        selectedCategory = i.values[0];
        await i.update(buildLogsPage(message.guildId, selectedCategory));
        return;
      }

      if (i.isChannelSelectMenu() && i.customId.startsWith("log_channel:")) {
        const category = i.customId.split(":")[1];
        const channelId = i.values[0];
        setLogChannel(message.guildId, category, channelId);
        await saveGuildConfig(i.guild, ["logChannels"]);
        await i.update(buildLogsPage(message.guildId, category));
      }
    } catch (err) {
      console.error("[logs] Erreur dans le panel logs :", err);
    }
  });
}

module.exports = { handleLogsCommand };
