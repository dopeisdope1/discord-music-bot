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
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const { getLogChannels, setLogChannel, LOG_CATEGORIES } = require("./logStore");
const { getAllowedRoles, setAllowedRoles, PERMISSION_GROUPS } = require("./rolePermStore");
const { validateMassRoleTarget, runMassRole } = require("./massRole");
const { saveGuildConfig } = require("./configChannel");

const PANEL_TIMEOUT_MS = 10 * 60_000;
const MAX_PREFIX_LENGTH = 5;
const MAX_ROLES_PER_GROUP = 10;

const TYPE_LABELS = {
  main: "musique",
  dash: "membres/modération",
};

const PAGES = {
  prefixes: "Préfixes",
  logs: "Logs",
  permissions: "Permissions",
};

function buildSimplePanel(text) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildNavRow(currentPage) {
  return new ActionRowBuilder().addComponents(
    Object.entries(PAGES).map(([page, label]) =>
      new ButtonBuilder()
        .setCustomId(`panel_page:${page}`)
        .setLabel(label)
        .setStyle(page === currentPage ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(page === currentPage)
    )
  );
}

function buildPrefixesPage(guildId) {
  const { main, dash } = getPrefixes(guildId);

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
  container.addActionRowComponents(buildNavRow("prefixes"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildLogsPage(guildId) {
  const logChannels = getLogChannels(guildId);

  const container = new ContainerBuilder();
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
  container.addActionRowComponents(buildNavRow("logs"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildPermissionsPage(guildId, guild) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Permissions\n> Autorise des rôles en plus des permissions Discord natives (Administrateur, " +
        "Bannir des membres) à utiliser certaines commandes — sans jamais les remplacer. Réservé aux " +
        "administrateurs du serveur."
    )
  );

  for (const group of Object.values(PERMISSION_GROUPS)) {
    const allowed = getAllowedRoles(guildId, group.key).filter((id) => guild.roles.cache.has(id));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${group.label}** (${group.description})\n> ${
          allowed.length ? allowed.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle supplémentaire*"
        }`
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`permrole:${group.key}`)
          .setPlaceholder(`${group.label} — choisir les rôles autorisés`)
          .setMinValues(0)
          .setMaxValues(MAX_ROLES_PER_GROUP)
          .setDefaultRoles(allowed)
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("massrole_open").setLabel("Gérer les rôles en masse").setStyle(ButtonStyle.Secondary)
    )
  );
  container.addActionRowComponents(buildNavRow("permissions"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildPanel(page, guild) {
  if (page === "logs") return buildLogsPage(guild.id);
  if (page === "permissions") return buildPermissionsPage(guild.id, guild);
  return buildPrefixesPage(guild.id);
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
 * Ouvre le panel d'administration (`.panel`, réservé aux administrateurs — la
 * vérification se fait avant l'appel de cette fonction), organisé en trois
 * pages navigables via les boutons du bas : Préfixes (musique/membres),
 * Logs (salon par catégorie) et Permissions (rôles autorisés en plus des
 * permissions Discord natives, par groupe de commandes). Un bouton "Gérer les
 * rôles en masse" sur la page Permissions ouvre un sous-panel dédié.
 * @param {import('discord.js').Message} message
 */
async function handlePrefixPanel(message) {
  const guild = message.guild;
  const guildId = guild.id;
  let currentPage = "prefixes";
  const panelMessage = await message.reply(buildPanel(currentPage, guild));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isButton() && i.customId.startsWith("panel_page:")) {
        currentPage = i.customId.split(":")[1];
        await i.update(buildPanel(currentPage, guild));
        return;
      }

      if (i.isChannelSelectMenu() && i.customId.startsWith("log_channel:")) {
        const category = i.customId.split(":")[1];
        const channelId = i.values[0];
        setLogChannel(guildId, category, channelId);
        saveGuildConfig(i.guild);
        await i.update(buildPanel(currentPage, guild));
        return;
      }

      if (i.isRoleSelectMenu() && i.customId.startsWith("permrole:")) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
          await i.reply({
            content: "Seul un administrateur du serveur peut modifier les permissions de rôle.",
            ephemeral: true,
          });
          return;
        }
        const group = i.customId.split(":")[1];
        setAllowedRoles(guildId, group, i.values);
        saveGuildConfig(i.guild);
        await i.update(buildPanel(currentPage, guild));
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
        await submitted.update(buildPanel(currentPage, guild));
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
