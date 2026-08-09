const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { randomClearJoke } = require("./jokes");
const { sendLog } = require("./actionLogger");

const PANEL_TIMEOUT_MS = 60_000;

// Le panel initial est envoyé en Components V2 (flag IS_COMPONENTS_V2) : ce
// flag ne peut pas être retiré/mélangé avec un `embeds` classique lors d'une
// édition ultérieure du même message, donc toutes les mises à jour de ce
// panel doivent elles aussi rester en Components V2, sous peine d'échouer en
// silence (le ban/débannissement se fait, mais rien ne s'affiche).
function buildStatusPanel(text) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// Filet de sécurité : sans ça, une exception dans un handler de collector part
// en promesse non gérée, ce qui peut faire planter tout le process (donc
// redémarrer le bot) et laisse l'utilisateur avec le message d'erreur générique
// de Discord ("Une erreur s'est produite. Réessaie.") sans aucune réponse réelle.
async function safeErrorReply(i) {
  try {
    if (i.deferred || i.replied) {
      await i.editReply(buildStatusPanel("Une erreur est survenue, réessaie."));
    } else {
      await i.reply({ content: "Une erreur est survenue, réessaie.", ephemeral: true });
    }
  } catch {
    /* rien de plus possible côté Discord */
  }
}

// Panel "recherche" : un simple bouton qui ouvre une modale (fenêtre avec un
// champ texte). Contrairement à un UserSelectMenu/StringSelectMenu natif,
// rien ne s'affiche tant que l'utilisateur n'a pas tapé et validé une
// recherche — les menus déroulants natifs Discord affichent toujours une
// liste par défaut au clic, comportement du client impossible à désactiver
// via l'API (voir section 7ter du README).
function buildSearchPanel(headerText, searchButtonId) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(searchButtonId).setLabel("🔍 Chercher un membre").setStyle(ButtonStyle.Secondary)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// Panel "résultats" : menu déroulant peuplé uniquement des correspondances de
// la recherche (jamais de la liste complète des membres/bannis).
function buildResultsPanel(headerText, selectId, options) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId).setPlaceholder("Choisis dans les résultats").addOptions(options)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildSearchModal(modalId) {
  return new ModalBuilder()
    .setCustomId(modalId)
    .setTitle("Chercher un membre")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Pseudo ou ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      )
    );
}

const BAN_SEARCH_BUTTON = "zinki_ban_search";
const BAN_MODAL = "zinki_ban_modal";
const BAN_RESULT_SELECT = "zinki_ban_result_select";
const UNBAN_SELECT = "unban_select";

async function banTarget(interaction, message, targetId) {
  if (targetId === message.author.id) {
    await interaction.update(buildStatusPanel("Tu ne peux pas te bannir toi-même."));
    return;
  }
  if (targetId === message.client.user.id) {
    await interaction.update(buildStatusPanel("Je ne vais pas me bannir moi-même."));
    return;
  }

  // Accuse réception tout de suite (dans les 3s imposées par Discord) : le
  // fetch du membre + le ban lui-même sont de vraies requêtes réseau qui
  // peuvent facilement dépasser ce délai, d'où le "n'a pas répondu à temps".
  await interaction.deferUpdate();

  const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
  if (targetMember && !targetMember.bannable) {
    await interaction.editReply(
      buildStatusPanel("Je ne peux pas bannir ce membre (rôle trop élevé ou permissions insuffisantes).")
    );
    return;
  }

  const banResult = await message.guild.members
    .ban(targetId, { reason: `Zinki Assassini — banni par ${message.author.tag}` })
    .catch((err) => {
      console.error(err);
      return null;
    });

  if (!banResult) {
    await interaction.editReply(
      buildStatusPanel(
        `Impossible de bannir ${targetMember ? targetMember.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`
      )
    );
    return;
  }

  await interaction.editReply(
    buildStatusPanel(`${targetMember ? targetMember.user.tag : `<@${targetId}>`} a été banni — ${randomClearJoke()}`)
  );
  sendLog(message.client, message.guild.id, "moderation", {
    title: "Ban",
    description: "Membre banni via Zinki Assassini.",
    actor: message.author,
    fields: [
      { name: "Cible", value: targetMember ? `${targetMember.user.tag} (${targetId})` : `<@${targetId}>`, inline: true },
    ],
  });
}

/**
 * Ouvre le panel "Zinki Assassini" (`.ban`, réservé aux administrateurs — la
 * vérification se fait avant l'appel de cette fonction). Bouton "Chercher"
 * qui ouvre une modale : aucune liste de membres ne s'affiche tant que
 * l'utilisateur n'a pas tapé et validé une recherche, seuls les résultats
 * correspondants apparaissent ensuite dans un menu déroulant.
 * @param {import('discord.js').Message} message
 */
async function handleBanPanel(message) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    return;
  }

  const panelMessage = await message.reply(
    buildSearchPanel(
      "## Zinki Assassini\n> Clique pour chercher qui bannir (aucune liste tant que tu n'as rien tapé).",
      BAN_SEARCH_BUTTON
    )
  );
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });
  let done = false;

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isButton() && i.customId === BAN_SEARCH_BUTTON) {
        await i.showModal(buildSearchModal(BAN_MODAL));
        const submitted = await i
          .awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === BAN_MODAL && m.user.id === message.author.id,
          })
          .catch(() => null);
        if (!submitted) return;

        const query = submitted.fields.getTextInputValue("query").trim();
        const results = await message.guild.members.search({ query, limit: 25 }).catch(() => null);
        const matches = results
          ? [...results.values()].filter((m) => m.id !== message.author.id && m.id !== message.client.user.id)
          : [];

        if (matches.length === 0) {
          await submitted.update(
            buildSearchPanel(`## Zinki Assassini\n> Aucun membre trouvé pour "${query}". Réessaie.`, BAN_SEARCH_BUTTON)
          );
          return;
        }

        await submitted.update(
          buildResultsPanel(
            `## Zinki Assassini\n> ${matches.length} résultat${matches.length > 1 ? "s" : ""} pour "${query}" — choisis qui bannir.`,
            BAN_RESULT_SELECT,
            matches.map((m) => ({ label: m.user.tag.slice(0, 100), value: m.id }))
          )
        );
        return;
      }

      if (i.isStringSelectMenu() && i.customId === BAN_RESULT_SELECT) {
        await banTarget(i, message, i.values[0]);
        done = true;
        collector.stop();
      }
    } catch (err) {
      console.error("[banPanel] Erreur dans le panel Zinki Assassini :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", () => {
    if (!done) panelMessage.edit({ components: [] }).catch(() => {});
  });
}

/**
 * Débannit directement un membre par ID (`.unban <id>`).
 * @param {import('discord.js').Message} message
 * @param {string} userId
 */
async function unbanById(message, userId) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    return;
  }

  const result = await message.guild.bans
    .remove(userId, `Débanni par ${message.author.tag}`)
    .catch((err) => {
      console.error(err);
      return null;
    });

  if (!result) {
    await message.reply({
      embeds: [buildStatusEmbed("error", "Impossible de débannir cet ID (pas banni, ou erreur Discord).")],
    });
    return;
  }

  await message.reply({
    embeds: [buildStatusEmbed("success", `<@${userId}> a été débanni — ${randomClearJoke()}`)],
  });
  sendLog(message.client, message.guild.id, "moderation", {
    title: "Unban",
    description: "Membre débanni (par ID).",
    actor: message.author,
    fields: [{ name: "Cible", value: `<@${userId}> (${userId})`, inline: true }],
  });
}

async function unbanTarget(interaction, message, targetId, target) {
  await interaction.deferUpdate();

  const result = await message.guild.bans
    .remove(targetId, `Débanni par ${message.author.tag}`)
    .catch((err) => {
      console.error(err);
      return null;
    });

  if (!result) {
    await interaction.editReply(
      buildStatusPanel(
        `Impossible de débannir ${target ? target.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`
      )
    );
    return;
  }

  await interaction.editReply(
    buildStatusPanel(`${target ? target.user.tag : `<@${targetId}>`} a été débanni — ${randomClearJoke()}`)
  );
  sendLog(message.client, message.guild.id, "moderation", {
    title: "Unban",
    description: "Membre débanni via Zinki Assassini.",
    actor: message.author,
    fields: [{ name: "Cible", value: target ? `${target.user.tag} (${targetId})` : `<@${targetId}>`, inline: true }],
  });
}

/**
 * Ouvre un panel listant les membres actuellement bannis, pour en débannir un
 * (`.unban` sans argument, réservé aux administrateurs — la vérification se
 * fait avant l'appel de cette fonction). Menu déroulant natif Discord
 * (StringSelectMenu) directement : la liste des bannis est généralement
 * courte, donc contrairement à `.ban` on l'affiche tout de suite plutôt que
 * de passer par une recherche — taper filtre en direct parmi les options.
 * @param {import('discord.js').Message} message
 */
async function handleUnbanPanel(message) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    return;
  }

  const bans = await message.guild.bans.fetch().catch(() => null);
  if (!bans || bans.size === 0) {
    await message.reply({ embeds: [buildStatusEmbed("info", "Aucun membre banni sur ce serveur.")] });
    return;
  }

  const entries = [...bans.values()].slice(0, 25);
  const panelMessage = await message.reply(
    buildResultsPanel(
      `## Zinki Assassini\n> Choisis qui débannir${
        bans.size > 25 ? ` (${bans.size} bannis au total, 25 premiers affichés — utilise \`.unban <id>\` pour les autres)` : ""
      } (tape un pseudo pour filtrer).`,
      UNBAN_SELECT,
      entries.map((ban) => ({
        label: ban.user.tag.slice(0, 100),
        value: ban.user.id,
        description: ban.reason ? ban.reason.slice(0, 100) : undefined,
      }))
    )
  );
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS, max: 1 });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      const targetId = i.values[0];
      const target = entries.find((ban) => ban.user.id === targetId);
      await unbanTarget(i, message, targetId, target);
    } catch (err) {
      console.error("[banPanel] Erreur dans le panel de débannissement :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      panelMessage.edit({ components: [] }).catch(() => {});
    }
  });
}

module.exports = { handleBanPanel, handleUnbanPanel, unbanById };
