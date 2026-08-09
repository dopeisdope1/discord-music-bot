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
const { sendLog } = require("./actionLogger");
const { memberFetchErrorMessage } = require("./guildMembers");

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
  roles: "Rôles",
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

function buildRolesPage(guild, statusText) {
  const container = new ContainerBuilder();

  if (statusText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Rôles\n> Crée un nouveau rôle, supprime un rôle existant (action irréversible, une confirmation est demandée), ou réorganise sa position dans la hiérarchie."
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("role_create_open").setLabel("➕ Créer un rôle").setStyle(ButtonStyle.Secondary)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("role_delete_select")
        .setPlaceholder("🗑️ Choisir un rôle à supprimer")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("role_move_select")
        .setPlaceholder("↕️ Choisir un rôle à réorganiser (hiérarchie)")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(buildNavRow("roles"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// Classement des rôles du serveur du plus haut au plus bas dans la
// hiérarchie, @everyone exclu (toujours en bas, position fixe, pas
// pertinent à afficher/déplacer ici).
function rankedRoles(guild) {
  return [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
}

function buildRoleMovePanel(guild, role) {
  const sorted = rankedRoles(guild);
  const rank = sorted.findIndex((r) => r.id === role.id) + 1;
  const maxPosition = guild.members.me.roles.highest.position - 1;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Déplacer le rôle **${role.name}**\n> Position actuelle : **${rank}** / ${sorted.length} (1 = le plus haut). Utilise les boutons pour le monter ou le descendre d'un cran.`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`role_move:up:${role.id}`)
        .setLabel("⬆️ Monter")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(role.position >= maxPosition),
      new ButtonBuilder()
        .setCustomId(`role_move:down:${role.id}`)
        .setLabel("⬇️ Descendre")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(role.position <= 1),
      new ButtonBuilder().setCustomId("role_move_done").setLabel("Retour").setStyle(ButtonStyle.Secondary)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildRoleDeleteConfirmPanel(role) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Supprimer le rôle **${role.name}** ?\n> Action irréversible — ${role.members.size} membre(s) actuellement concerné(s) le perdront.`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`role_delete_confirm:${role.id}`)
        .setLabel("Confirmer la suppression")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("role_delete_cancel").setLabel("Annuler").setStyle(ButtonStyle.Secondary)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildRoleCreateModal() {
  return new ModalBuilder()
    .setCustomId("role_create_modal")
    .setTitle("Créer un rôle")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Nom du rôle")
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true)
      )
    );
}

// Le nom d'un rôle doit rester en texte libre (modale, ci-dessus — aucun
// menu déroulant ne permet de saisir du texte arbitraire), mais la couleur
// se prête bien à une liste fermée : après la modale, un menu déroulant
// (même style que "Choisir un rôle à supprimer") propose un choix de
// couleurs prédéfinies plutôt qu'un champ hex à taper à la main.
const ROLE_COLOR_PRESETS = [
  { label: "Par défaut (pas de couleur)", value: "none" },
  { label: "Rouge", value: "e74c3c" },
  { label: "Orange", value: "e67e22" },
  { label: "Jaune", value: "f1c40f" },
  { label: "Vert", value: "2ecc71" },
  { label: "Cyan", value: "1abc9c" },
  { label: "Bleu", value: "3498db" },
  { label: "Violet", value: "9b59b6" },
  { label: "Rose", value: "e91e63" },
  { label: "Gris", value: "95a5a6" },
  { label: "Annuler la création", value: "cancel" },
];

function buildRoleColorPanel(name) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Créer le rôle **${name}**\n> Choisis une couleur.`)
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("role_create_color")
        .setPlaceholder("Choisir une couleur")
        .addOptions(ROLE_COLOR_PRESETS)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildPanel(page, guild, statusText) {
  if (page === "logs") return buildLogsPage(guild.id);
  if (page === "permissions") return buildPermissionsPage(guild.id, guild);
  if (page === "roles") return buildRolesPage(guild, statusText);
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
 * vérification se fait avant l'appel de cette fonction), organisé en quatre
 * pages navigables via les boutons du bas : Préfixes (musique/membres),
 * Logs (salon par catégorie), Permissions (rôles autorisés en plus des
 * permissions Discord natives, par groupe de commandes) et Rôles (créer/
 * supprimer un rôle du serveur avec confirmation avant suppression, et
 * réorganiser sa position dans la hiérarchie via deux boutons monter/
 * descendre). Un bouton "Gérer les rôles en masse" sur la page Permissions
 * ouvre un sous-panel dédié.
 * @param {import('discord.js').Message} message
 */
async function handlePrefixPanel(message) {
  const guild = message.guild;
  const guildId = guild.id;
  let currentPage = "prefixes";
  // Nom saisi dans la modale de création de rôle, en attente du choix de
  // couleur (interaction suivante) — voir "role_create_open"/"role_create_color".
  let pendingRoleName = null;
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

      if (i.isRoleSelectMenu() && i.customId === "role_delete_select") {
        const role = i.roles.first();
        const invalidReason =
          role.id === guildId ? "Impossible de supprimer le rôle @everyone." : validateMassRoleTarget(guild, role);
        if (invalidReason) {
          await i.reply({ content: invalidReason, ephemeral: true });
          return;
        }
        await i.update(buildRoleDeleteConfirmPanel(role));
        return;
      }

      if (i.isButton() && i.customId === "role_delete_cancel") {
        currentPage = "roles";
        await i.update(buildPanel(currentPage, guild));
        return;
      }

      if (i.isButton() && i.customId.startsWith("role_delete_confirm:")) {
        const roleId = i.customId.split(":")[1];
        const role = guild.roles.cache.get(roleId);
        currentPage = "roles";
        if (!role) {
          await i.update(buildPanel(currentPage, guild, "Ce rôle n'existe déjà plus."));
          return;
        }
        const name = role.name;
        const deleted = await role
          .delete(`Supprimé via .panel par ${message.author.tag}`)
          .then(() => true)
          .catch((err) => {
            console.error(err);
            return false;
          });
        if (deleted) {
          sendLog(i.client, guildId, "roles", {
            title: "Suppression de rôle",
            description: `Rôle **${name}** supprimé.`,
            actor: message.author,
          });
        }
        await i.update(
          buildPanel(currentPage, guild, deleted ? `Rôle **${name}** supprimé.` : `Impossible de supprimer **${name}** (erreur Discord).`)
        );
        return;
      }

      if (i.isRoleSelectMenu() && i.customId === "role_move_select") {
        const role = i.roles.first();
        const invalidReason =
          role.id === guildId ? "Impossible de déplacer le rôle @everyone." : validateMassRoleTarget(guild, role);
        if (invalidReason) {
          await i.reply({ content: invalidReason, ephemeral: true });
          return;
        }
        await i.update(buildRoleMovePanel(guild, role));
        return;
      }

      if (i.isButton() && i.customId === "role_move_done") {
        currentPage = "roles";
        await i.update(buildPanel(currentPage, guild));
        return;
      }

      if (i.isButton() && i.customId.startsWith("role_move:")) {
        const [, direction, roleId] = i.customId.split(":");
        const role = guild.roles.cache.get(roleId);
        if (!role) {
          currentPage = "roles";
          await i.update(buildPanel(currentPage, guild, "Ce rôle n'existe déjà plus."));
          return;
        }
        const invalidReason = validateMassRoleTarget(guild, role);
        if (invalidReason) {
          await i.reply({ content: invalidReason, ephemeral: true });
          return;
        }

        const newPosition = Math.max(role.position + (direction === "up" ? 1 : -1), 1);
        const moved = await role
          .setPosition(newPosition, { reason: `Réordonné via .panel par ${message.author.tag}` })
          .catch((err) => {
            console.error(err);
            return null;
          });

        if (!moved) {
          await i.reply({ content: "Impossible de déplacer ce rôle (erreur Discord — réessaie).", ephemeral: true });
          return;
        }
        await i.update(buildRoleMovePanel(guild, moved));
        return;
      }

      if (i.isButton() && i.customId === "role_create_open") {
        if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await i.reply({ content: "Il me manque la permission **Gérer les rôles**.", ephemeral: true });
          return;
        }
        await i.showModal(buildRoleCreateModal());

        const submitted = await i
          .awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === "role_create_modal" && m.user.id === message.author.id,
          })
          .catch(() => null);
        if (!submitted) return;

        pendingRoleName = submitted.fields.getTextInputValue("name").trim();
        await submitted.update(buildRoleColorPanel(pendingRoleName));
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "role_create_color") {
        currentPage = "roles";
        const name = pendingRoleName;
        const choice = i.values[0];
        pendingRoleName = null;

        if (!name || choice === "cancel") {
          await i.update(buildPanel(currentPage, guild, choice === "cancel" ? "Création annulée." : undefined));
          return;
        }

        const color = choice === "none" ? undefined : parseInt(choice, 16);
        const role = await guild.roles
          .create({ name, color, reason: `Créé via .panel par ${message.author.tag}` })
          .catch((err) => {
            console.error(err);
            return null;
          });

        if (!role) {
          await i.update(buildPanel(currentPage, guild, "Impossible de créer ce rôle (nom invalide, ou limite de rôles atteinte)."));
          return;
        }

        sendLog(i.client, guildId, "roles", {
          title: "Création de rôle",
          description: `Rôle **${role.name}** créé.`,
          actor: message.author,
        });
        await i.update(buildPanel(currentPage, guild, `Rôle **${role.name}** créé.`));
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
            await replyWithError(sub, memberFetchErrorMessage(err) ?? undefined);
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
