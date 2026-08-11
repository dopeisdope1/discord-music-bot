const {
  ContainerBuilder,
  TextDisplayBuilder,
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

// Un type par bot — chacun lit son propre préfixe via getPrefixes(guildId)
// (voir utils/prefixStore.js) dans son propre process (music+modération pour
// main/dash, logs.js/antifast.js/blacklist.js pour les 3 autres).
const TYPE_LABELS = {
  main: "musique",
  dash: "membres/modération",
  logs: "logs",
  antifast: "antifast",
  blacklist: "blacklist",
};

function buildPrefixesPage(guildId) {
  const prefixes = getPrefixes(guildId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Préfixes des bots\n" +
        `> Musique : \`${prefixes.main}\`\n` +
        `> Membres/modération (dont \`${prefixes.dash}ban\`/\`${prefixes.dash}unban\`) : \`${prefixes.dash}\`\n` +
        `> Logs : \`${prefixes.logs}\`\n` +
        `> Antifast : \`${prefixes.antifast}\`\n` +
        `> Blacklist : \`${prefixes.blacklist}\``
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      Object.keys(TYPE_LABELS).map((type) =>
        new ButtonBuilder()
          .setCustomId(`prefix_edit:${type}`)
          .setLabel(`Changer préfixe ${TYPE_LABELS[type]}`)
          .setStyle(ButtonStyle.Secondary)
      )
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
 * vérification se fait avant l'appel de cette fonction) : les préfixes des 5
 * bots (musique, membres/modération, logs, antifast, blacklist). Chaque bot
 * relit sa propre valeur via utils/prefixStore.js, synchronisée entre tous
 * les process via le salon Discord partagé "zinki-config" (voir
 * utils/configChannel.js).
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

      const type = i.customId.split(":")[1];
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

        if (!raw || /\s/.test(raw) || raw.length > MAX_PREFIX_LENGTH) {
          await submitted.reply({
            content: "Préfixe invalide : pas d'espace, 1 à 5 caractères.",
            ephemeral: true,
          });
          return;
        }

        // Un seul préfixe par bot à la fois : évite qu'un message tape dans
        // deux bots différents (ou soit ambigu à lire) si deux préfixes se
        // chevauchent (ex: l'un est le début de l'autre).
        const conflict = Object.keys(TYPE_LABELS).find((otherType) => {
          if (otherType === type) return false;
          const other = prefixes[otherType];
          return raw === other || raw.startsWith(other) || other.startsWith(raw);
        });
        if (conflict) {
          await submitted.reply({
            content: `Ce préfixe entre en conflit avec le préfixe ${TYPE_LABELS[conflict]} actuel (\`${prefixes[conflict]}\`), choisis-en un autre.`,
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
