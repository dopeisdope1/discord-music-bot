const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
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

function buildLogsPage(guildId) {
  const logChannels = getLogChannels(guildId);
  const { dash } = getPrefixes(guildId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Logs\n> Choisis un salon par catégorie ci-dessous pour y recevoir les logs correspondants.\n" +
        Object.values(LOG_CATEGORIES)
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

/**
 * `=logs` (bot Sécurité, réservé aux owners anti-nuke — voir `=owner`) :
 * choisit le salon de destination pour chaque catégorie de logs. Les
 * messages sont ensuite postés par le bot concerné (Musique+Modération pour
 * "moderation"/"salon"/"roles", ce bot-ci pour "securite"/"blacklist") —
 * voir utils/actionLogger.js, la config est partagée entre les deux bots via
 * le salon Discord "zinki-config" (utils/configChannel.js).
 * @param {import('discord.js').Message} message
 */
async function handleLogsCommand(message) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke de ce serveur (voir `=owner`).")] });
  }

  await waitForHydration(message.guildId);
  const panelMessage = await message.reply(buildLogsPage(message.guildId));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }
      if (!i.isChannelSelectMenu() || !i.customId.startsWith("log_channel:")) return;

      const category = i.customId.split(":")[1];
      const channelId = i.values[0];
      setLogChannel(message.guildId, category, channelId);
      await saveGuildConfig(i.guild, ["logChannels"]);
      await i.update(buildLogsPage(message.guildId));
    } catch (err) {
      console.error("[logs] Erreur dans le panel logs :", err);
    }
  });
}

module.exports = { handleLogsCommand };
