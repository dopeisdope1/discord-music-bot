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
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const { saveGuildConfig, waitForHydration } = require("./configChannel");
const { DELEGABLE_COMMANDS, getAllGrants, setRolesForCommand } = require("./commandPermissionStore");

const PANEL_TIMEOUT_MS = 10 * 60_000;
const MAX_PREFIX_LENGTH = 5;
const MAX_ROLES_PER_COMMAND = 10;

// Un bot, deux préfixes indépendants — voir utils/prefixStore.js.
const TYPE_LABELS = {
  main: "musique",
  musicMod: "modération",
};

const PAGES = { prefixes: "Préfixes", permissions: "Permissions" };

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
 * Ouvre le panel d'administration (accessible via `&panel`, réservé aux
 * administrateurs — la vérification se fait avant l'appel de cette
 * fonction) : préfixes et délégation de commandes à des rôles. Les valeurs
 * sont synchronisées via le salon Discord partagé "zinki-config" (voir
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
  // Commande actuellement sélectionnée sur la page Permissions (état local
  // au panel, pas persisté — un nouveau `.panel` repart sans sélection).
  let selectedCommand = null;
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
        await i.update(currentPage === "permissions" ? buildPermissionsPage(guildId, null) : buildPrefixesPage(guildId));
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
