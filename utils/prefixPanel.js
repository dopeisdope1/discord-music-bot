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
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const { saveGuildConfig, waitForHydration } = require("./configChannel");
const { DELEGABLE_COMMANDS, getAllGrants, setRolesForCommand } = require("./commandPermissionStore");
const {
  TIER_DEFINITIONS,
  ALL_TIER_COMMANDS,
  getRoleTiers,
  setRoleTier,
  removeRoleTier,
  getCommandTierMap,
  getCumulativeCommands,
  setCommandTier,
} = require("./permTierStore");
const {
  setWelcomeChannel,
  getWelcomeChannel,
  getWelcomeMessages,
  addWelcomeMessage,
  removeWelcomeMessage,
  setWelcomeDeleteDelay,
  getWelcomeDeleteDelay,
} = require("./welcomeStore");

const PANEL_TIMEOUT_MS = 10 * 60_000;
const MAX_PREFIX_LENGTH = 5;
const MAX_ROLES_PER_COMMAND = 10;

// Options du menu "suppression auto" de la page Bienvenue — voir
// utils/welcomeStore.js (0 = ne jamais supprimer).
const WELCOME_DELETE_DELAYS = [
  { label: "Jamais (par défaut)", value: 0 },
  { label: "5 secondes", value: 5_000 },
  { label: "10 secondes", value: 10_000 },
  { label: "30 secondes", value: 30_000 },
  { label: "1 minute", value: 60_000 },
  { label: "5 minutes", value: 300_000 },
];
const MAX_WELCOME_MESSAGE_LENGTH = 300;

// Un bot, deux préfixes indépendants — voir utils/prefixStore.js.
const TYPE_LABELS = {
  main: "musique",
  musicMod: "modération",
};

const PAGES = { prefixes: "Préfixes", permissions: "Permissions", tiers: "Paliers", welcome: "Bienvenue" };

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
  const prefixes = getPrefixes(guildId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Préfixes\n" +
        `> Musique : \`${prefixes.main}\`\n` +
        `> Modération (ban/unban/clear/lock/...) : \`${prefixes.musicMod}\``
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
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(buildNavRow("prefixes"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Page "Permissions" : délègue une commande de modération à un ou plusieurs
 * rôles (en plus d'Administrateur natif, toujours autorisé). Choisir une
 * commande dans le menu déroulant affiche un second menu (rôles) pré-rempli
 * avec les rôles déjà autorisés pour cette commande — le choix remplace
 * l'ensemble complet (comme un RoleSelectMenu classique).
 * @param {string} guildId
 * @param {string|null} selectedCommand
 * @param {string} [statusText]
 */
function buildPermissionsPage(guildId, selectedCommand, statusText) {
  const grants = getAllGrants(guildId);
  const container = new ContainerBuilder();

  if (statusText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  }

  const summary = DELEGABLE_COMMANDS.map((cmd) => {
    const roles = grants[cmd] || [];
    return `**${cmd}** — ${roles.length ? roles.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle (Administrateur uniquement)*"}`;
  }).join("\n");

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Permissions\n> Choisis une commande, puis les rôles autorisés à l'utiliser — en plus d'Administrateur, " +
        "toujours autorisé nativement.\n\n" +
        summary
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("perm_command_select")
        .setPlaceholder("Choisir une commande")
        .addOptions(
          DELEGABLE_COMMANDS.map((cmd) => ({ label: cmd, value: cmd, default: cmd === selectedCommand }))
        )
    )
  );

  if (selectedCommand) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`perm_role_select:${selectedCommand}`)
          .setPlaceholder(`Rôles autorisés pour "${selectedCommand}"`)
          .setMinValues(0)
          .setMaxValues(MAX_ROLES_PER_COMMAND)
          .setDefaultRoles(grants[selectedCommand] || [])
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(buildNavRow("permissions"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Page "Paliers" : gère le système de paliers de permission (voir
 * utils/permTierStore.js — `&perms`/`&helpall`) directement depuis le
 * panel. Un palier sélectionné affiche ses rôles (RoleSelectMenu) ET une
 * case à cocher par commande (StringSelectMenu multi-select) : cocher une
 * commande la rend disponible à partir de ce palier, la décocher la
 * repousse au palier suivant (elle reste débloquée pour un palier plus
 * élevé, sauf à la décocher aussi là-bas — jusqu'à disparaître de tous les
 * paliers si décochée au palier le plus haut).
 * @param {string} guildId
 * @param {number|null} selectedTier
 * @param {string} [statusText]
 */
function buildTiersPage(guildId, selectedTier, statusText) {
  const roleMapping = getRoleTiers(guildId);
  const commandMap = getCommandTierMap(guildId);

  const byTier = {};
  for (const [roleId, tier] of Object.entries(roleMapping)) (byTier[tier] ||= []).push(roleId);
  const commandsByTier = {};
  for (const [cmd, tier] of Object.entries(commandMap)) (commandsByTier[tier] ||= []).push(cmd);

  const container = new ContainerBuilder();

  if (statusText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  }

  const summary = TIER_DEFINITIONS.map((t) => {
    const roleIds = byTier[t.level] || [];
    const rolesText = roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle*";
    const cmds = (commandsByTier[t.level] || []).join(", ") || "*aucune*";
    return `**${t.label}**\n> Commandes : ${cmds}\n> Rôles : ${rolesText}`;
  }).join("\n\n");

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Paliers\n> Choisis un palier pour éditer ses rôles et cocher/décocher les commandes débloquées (cumulatif : un palier a aussi tout ce que les paliers en dessous ont).\n\n" +
        summary
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("palier_select")
        .setPlaceholder("Choisir un palier")
        .addOptions(
          TIER_DEFINITIONS.map((t) => ({ label: t.label, value: String(t.level), default: t.level === selectedTier }))
        )
    )
  );
  if (selectedTier) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`palier_role_select:${selectedTier}`)
          .setPlaceholder(`Rôles pour le palier ${selectedTier}`)
          .setMinValues(0)
          .setMaxValues(MAX_ROLES_PER_COMMAND)
          .setDefaultRoles(byTier[selectedTier] || [])
      )
    );

    const cumulative = new Set(getCumulativeCommands(guildId, selectedTier));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`palier_commands_select:${selectedTier}`)
          .setPlaceholder(`Commandes débloquées au palier ${selectedTier}`)
          .setMinValues(0)
          .setMaxValues(ALL_TIER_COMMANDS.length)
          .addOptions(ALL_TIER_COMMANDS.map((cmd) => ({ label: cmd, value: cmd, default: cumulative.has(cmd) })))
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Page "Bienvenue" : configure le salon et les messages de bienvenue
 * directement depuis le panel (équivalent de `greet`/`addbienvenue`/
 * `delbienvenue`/`listbienvenue`).
 * @param {string} guildId
 * @param {string} [statusText]
 */
function buildWelcomePage(guildId, statusText) {
  const channelId = getWelcomeChannel(guildId);
  const messages = getWelcomeMessages(guildId);
  const deleteAfterMs = getWelcomeDeleteDelay(guildId);

  const container = new ContainerBuilder();

  if (statusText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  }

  const lines = messages.length
    ? messages.map((m, i) => `${i + 1}. ${m}`).join("\n")
    : "*Aucun message personnalisé — les messages par défaut sont utilisés.*";
  const delayLabel = WELCOME_DELETE_DELAYS.find((d) => d.value === deleteAfterMs)?.label || `${deleteAfterMs} ms`;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Bienvenue\n" +
        `> Salon : ${channelId ? `<#${channelId}>` : "*non configuré*"}\n` +
        `> Suppression auto : ${delayLabel}\n\n` +
        "**Messages** (un est tiré au hasard à chaque arrivée)\n" +
        lines
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("greet_channel_select")
        .setPlaceholder("Envoyer le message de bienvenue à ce salon")
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("welcome_delete_delay_select")
        .setPlaceholder("Supprimer le message après un certain temps")
        .addOptions(
          WELCOME_DELETE_DELAYS.map((d) => ({ label: d.label, value: String(d.value), default: d.value === deleteAfterMs }))
        )
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("welcome_add_button")
        .setLabel("Ajouter un message")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  if (messages.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("welcome_remove_select")
          .setPlaceholder("Retirer un message")
          .addOptions(
            messages.slice(0, 25).map((m, i) => ({
              label: `${i + 1}. ${m}`.slice(0, 100),
              value: String(i + 1),
            }))
          )
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(buildNavRow("welcome"));

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

function buildWelcomeMessageModal() {
  return new ModalBuilder()
    .setCustomId("welcome_message_modal")
    .setTitle("Nouveau message de bienvenue")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel("Message (ex : Bienvenue {membre} !)")
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(MAX_WELCOME_MESSAGE_LENGTH)
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
 * Ouvre le panel d'administration (accessible via `&panel`, réservé aux
 * administrateurs — la vérification se fait avant l'appel de cette
 * fonction) : préfixes, délégation de commandes à des rôles, paliers de
 * permission, et configuration des messages de bienvenue. Les valeurs sont
 * synchronisées via le salon Discord partagé "zinki-config" (voir
 * utils/configChannel.js), pour survivre aux redéploiements Railway.
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
  let currentPage = "prefixes";
  // État local aux différentes pages (pas persisté — un nouveau `&panel`
  // repart sans sélection).
  let selectedCommand = null;
  let selectedTier = null;
  const panelMessage = await message.reply(buildPrefixesPage(guildId));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isButton() && i.customId.startsWith("panel_page:")) {
        currentPage = i.customId.split(":")[1];
        selectedCommand = null;
        selectedTier = null;
        const builders = {
          permissions: () => buildPermissionsPage(guildId, null),
          tiers: () => buildTiersPage(guildId, null),
          welcome: () => buildWelcomePage(guildId),
        };
        await i.update((builders[currentPage] || (() => buildPrefixesPage(guildId)))());
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "perm_command_select") {
        selectedCommand = i.values[0];
        await i.update(buildPermissionsPage(guildId, selectedCommand));
        return;
      }

      if (i.isRoleSelectMenu() && i.customId.startsWith("perm_role_select:")) {
        const command = i.customId.split(":")[1];
        setRolesForCommand(guildId, command, i.values);
        await saveGuildConfig(i.guild, ["commandPermissions"]);
        selectedCommand = command;
        const roleList = i.values.length ? i.values.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle*";
        await i.update(buildPermissionsPage(guildId, command, `Rôles pour **${command}** mis à jour : ${roleList}`));
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "palier_select") {
        selectedTier = parseInt(i.values[0], 10);
        await i.update(buildTiersPage(guildId, selectedTier));
        return;
      }

      if (i.isRoleSelectMenu() && i.customId.startsWith("palier_role_select:")) {
        const level = parseInt(i.customId.split(":")[1], 10);
        const previousRoles = Object.entries(getRoleTiers(guildId))
          .filter(([, t]) => t === level)
          .map(([roleId]) => roleId);
        for (const roleId of previousRoles) {
          if (!i.values.includes(roleId)) removeRoleTier(guildId, roleId);
        }
        for (const roleId of i.values) setRoleTier(guildId, roleId, level);
        await saveGuildConfig(i.guild, ["permTiers"]);
        selectedTier = level;
        const roleList = i.values.length ? i.values.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle*";
        await i.update(buildTiersPage(guildId, level, `Rôles du palier ${level} mis à jour : ${roleList}`));
        return;
      }

      if (i.isStringSelectMenu() && i.customId.startsWith("palier_commands_select:")) {
        const level = parseInt(i.customId.split(":")[1], 10);
        const selected = new Set(i.values);
        const wasIncluded = new Set(getCumulativeCommands(guildId, level));

        for (const cmd of ALL_TIER_COMMANDS) {
          const included = wasIncluded.has(cmd);
          const nowIncluded = selected.has(cmd);
          if (included && !nowIncluded) {
            // Décoché : repoussé au palier suivant (invisible à celui-ci et
            // en dessous, mais reste débloqué à partir du palier suivant —
            // sauf à le décocher là-bas aussi).
            setCommandTier(guildId, cmd, level + 1);
          } else if (!included && nowIncluded) {
            // Coché : débloqué à partir de ce palier.
            setCommandTier(guildId, cmd, level);
          }
        }
        await saveGuildConfig(i.guild, ["permTiers"]);
        selectedTier = level;
        await i.update(buildTiersPage(guildId, level, `Commandes du palier ${level} mises à jour.`));
        return;
      }

      if (i.isChannelSelectMenu() && i.customId === "greet_channel_select") {
        setWelcomeChannel(guildId, i.values[0]);
        await saveGuildConfig(i.guild, ["welcome"]);
        await i.update(buildWelcomePage(guildId, `Salon de bienvenue mis à jour : <#${i.values[0]}>`));
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "welcome_delete_delay_select") {
        const ms = parseInt(i.values[0], 10);
        setWelcomeDeleteDelay(guildId, ms);
        await saveGuildConfig(i.guild, ["welcome"]);
        const label = WELCOME_DELETE_DELAYS.find((d) => d.value === ms)?.label || `${ms} ms`;
        await i.update(buildWelcomePage(guildId, `Suppression auto réglée sur : ${label}.`));
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "welcome_remove_select") {
        const index = parseInt(i.values[0], 10);
        const removed = removeWelcomeMessage(guildId, index);
        await saveGuildConfig(i.guild, ["welcome"]);
        await i.update(buildWelcomePage(guildId, removed ? `Message retiré : "${removed}"` : "Numéro invalide."));
        return;
      }

      if (i.isButton() && i.customId === "welcome_add_button") {
        await i.showModal(buildWelcomeMessageModal());
        let submitted;
        try {
          submitted = await i.awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === "welcome_message_modal" && m.user.id === message.author.id,
          });
        } catch {
          return;
        }
        try {
          const text = submitted.fields.getTextInputValue("value").trim();
          if (!text) {
            await submitted.reply({ content: "Message vide, réessaie.", ephemeral: true });
            return;
          }
          const count = addWelcomeMessage(guildId, text);
          await saveGuildConfig(submitted.guild, ["welcome"]);
          await submitted.update(buildWelcomePage(guildId, `Message #${count} ajouté : "${text}"`));
        } catch (err) {
          console.error("[panel] Erreur lors de l'ajout d'un message de bienvenue :", err);
          await replyWithError(submitted);
        }
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
