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
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const { saveGuildConfig, waitForHydration } = require("./configChannel");

const PANEL_TIMEOUT_MS = 10 * 60_000;
const MAX_PREFIX_LENGTH = 5;

const TYPE_LABELS = {
  main: "musique",
  dash: "membres/modération",
};

function buildPrefixesPage(guildId) {
  const { main, dash } = getPrefixes(guildId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Préfixes du bot\n> Musique : \`${main}\`\n> Membres/modération (dont \`${dash}ban\`/\`${dash}unban\`) : \`${dash}\`\n> Logs/Blacklist/Antifast : bot Sécurité, préfixe fixe \`=\``
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("prefix_edit:main").setLabel("Changer préfixe musique").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prefix_edit:dash").setLabel("Changer préfixe membres/modération").setStyle(ButtonStyle.Secondary)
    )
  );

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
          .setValue(current || "")
          .setRequired(true)
      )
    );
}

async function replyWithError(interaction, message = "Une erreur est survenue, réessaie.") {
  const payload = { content: message, ephemeral: true };
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    /* si même ça échoue, on ne peut plus rien faire côté Discord */
  }
}

/**
 * Ouvre le panel d'administration (`.panel`, réservé aux administrateurs — la
 * vérification se fait avant l'appel de cette fonction) : uniquement les
 * préfixes musique et membres/modération. Les logs se configurent désormais
 * via `=logs` sur le bot Sécurité (voir utils/logsPanel.js).
 * @param {import('discord.js').Message} message
 */
async function handlePrefixPanel(message) {
  const guild = message.guild;
  const guildId = guild.id;
  // Si le bot vient de redémarrer, attend que la config (préfixes...) ait
  // fini d'être restaurée depuis Discord avant de lire quoi que ce soit —
  // sinon le panel afficherait/repartirait de valeurs par défaut le temps
  // que la restauration se termine (voir configChannel.js).
  await waitForHydration(guildId);
  const panelMessage = await message.reply(buildPrefixesPage(guildId));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
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

      try {
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
        // "=" est réservé au bot Sécurité (=antifast/=owner/=wl/=allbots/
        // =blacklist/=logs), volontairement à part de ce système de préfixes
        // configurables.
        if (raw.startsWith("=")) {
          await submitted.reply({
            content: "`=` est réservé au bot Sécurité, choisis un autre préfixe.",
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
        await saveGuildConfig(submitted.guild, ["prefixes"]);
        await submitted.update(buildPrefixesPage(guildId));
      } catch (err) {
        console.error("[panel] Erreur lors du traitement de la modale de préfixe :", err);
        await replyWithError(submitted);
      }
    } catch (err) {
      console.error("[panel] Erreur dans le panel :", err);
      await replyWithError(i);
    }
  });
}

module.exports = { handlePrefixPanel };
