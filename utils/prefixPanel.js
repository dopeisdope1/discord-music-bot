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
  RoleSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const { getLogChannels, setLogChannel, LOG_CATEGORIES } = require("./logStore");
const { validateMassRoleTarget, runMassRole } = require("./massRole");
const { saveGuildConfig } = require("./configChannel");

const PANEL_TIMEOUT_MS = 10 * 60_000;
const MAX_PREFIX_LENGTH = 5;

const TYPE_LABELS = {
  main: "musique",
  dash: "membres/modération",
};

function buildSimplePanel(text) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

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

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("massrole_open").setLabel("Gérer les rôles en masse").setStyle(ButtonStyle.Secondary)
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

function buildMassRoleSubPanel() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Rôles en masse\n> Choisis un rôle dans le menu correspondant pour l'ajouter ou le retirer à **tous les membres** du serveur (hors bots). Ça ne ping personne."
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("massrole_select:add")
        .setPlaceholder("Ajouter ce rôle à tous les membres")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("massrole_select:remove")
        .setPlaceholder("Retirer ce rôle à tous les membres")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

async function replyWithError(interaction) {
  const payload = { content: "Une erreur est survenue, réessaie.", ephemeral: true };
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
 * Ouvre le panel de gestion des préfixes, des salons de logs et des rôles en
 * masse (`.panel`, réservé aux administrateurs — la vérification se fait
 * avant l'appel de cette fonction). Deux boutons ouvrent chacun une modale
 * pour changer le préfixe musique ou membres/mod ; trois menus déroulants
 * (recherche native Discord) choisissent le salon de logs par catégorie ; un
 * bouton "Gérer les rôles en masse" ouvre un sous-panel avec deux menus de
 * rôles (ajout/retrait) qui appliquent le changement à tous les membres.
 * @param {import('discord.js').Message} message
 */
async function handlePrefixPanel(message) {
  const guildId = message.guild.id;
  const panelMessage = await message.reply(buildPrefixPanel(guildId));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isChannelSelectMenu() && i.customId.startsWith("log_channel:")) {
        const category = i.customId.split(":")[1];
        const channelId = i.values[0];
        setLogChannel(guildId, category, channelId);
        saveGuildConfig(i.guild);
        await i.update(buildPrefixPanel(guildId));
        return;
      }

      if (i.isButton() && i.customId === "massrole_open") {
        const subMessage = await i.reply({ ...buildMassRoleSubPanel(), fetchReply: true });
        const subCollector = subMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

        subCollector.on("collect", async (sub) => {
          try {
            if (sub.user.id !== message.author.id) {
              await sub.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
              return;
            }
            if (!sub.isRoleSelectMenu() || !sub.customId.startsWith("massrole_select:")) return;

            const action = sub.customId.split(":")[1]; // "add" | "remove"
            const role = sub.roles.first();
            const invalidReason = validateMassRoleTarget(sub.guild, role);
            if (invalidReason) {
              await sub.reply({ content: invalidReason, ephemeral: true });
              return;
            }

            await sub.update(
              buildSimplePanel(`${action === "add" ? "Ajout" : "Retrait"} du rôle **${role.name}** en cours pour tous les membres...`)
            );

            const { success, failed } = await runMassRole({
              client: sub.client,
              guild: sub.guild,
              actor: message.author,
              action,
              role,
            });

            await sub.editReply(
              buildSimplePanel(
                `${action === "add" ? "Ajouté" : "Retiré"} **${role.name}** pour **${success}** membre(s)` +
                  (failed ? ` (${failed} échec(s))` : "") +
                  "."
              )
            );
          } catch (err) {
            console.error("[panel] Erreur dans le sous-panel rôles en masse :", err);
            await replyWithError(sub);
          }
        });
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
        if (raw === other || raw.startsWith(other) || other.startsWith(raw)) {
          await submitted.reply({
            content: `Ce préfixe entre en conflit avec le préfixe ${TYPE_LABELS[otherType]} actuel (\`${other}\`), choisis-en un autre.`,
            ephemeral: true,
          });
          return;
        }

        setPrefix(guildId, type, raw);
        saveGuildConfig(submitted.guild);
        await submitted.update(buildPrefixPanel(guildId));
      } catch (err) {
        console.error("[panel] Erreur lors du traitement de la modale de préfixe :", err);
        await replyWithError(submitted);
      }
    } catch (err) {
      console.error("[panel] Erreur dans le panel de préfixes :", err);
      await replyWithError(i);
    }
  });
}

module.exports = { handlePrefixPanel };
