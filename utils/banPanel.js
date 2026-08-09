const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
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

function buildSearchPanel(title, intro, buttonCustomId) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n> ${intro}`));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(buttonCustomId).setLabel("Rechercher un membre").setStyle(ButtonStyle.Secondary)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildSearchModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Pseudo, nom, ou ID")
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true)
      )
    );
}

function buildPickPanel(title, candidates, selectCustomId) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}\n> Plusieurs résultats correspondent, choisis :`)
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(selectCustomId)
        .setPlaceholder("Choisir")
        .addOptions(
          candidates.map((c) => ({
            label: c.label.slice(0, 100),
            value: c.value,
            description: c.description ? c.description.slice(0, 100) : undefined,
          }))
        )
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

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
 * vérification se fait avant l'appel de cette fonction). Pas de liste de
 * membres à parcourir : un bouton ouvre une recherche (pseudo/nom/ID) via
 * l'API de recherche de membres Discord, et ne propose un choix que s'il y a
 * plusieurs résultats.
 * @param {import('discord.js').Message} message
 */
async function handleBanPanel(message) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    return;
  }

  const panelMessage = await message.reply(
    buildSearchPanel("Zinki Assassini", "Clique pour rechercher qui bannir (pseudo, nom ou ID).", "zinki_search_open")
  );

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isButton() && i.customId === "zinki_search_open") {
        await i.showModal(buildSearchModal("zinki_search_modal", "Rechercher un membre à bannir"));

        let submitted;
        try {
          submitted = await i.awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === "zinki_search_modal" && m.user.id === message.author.id,
          });
        } catch {
          return; // pas de soumission dans les temps
        }

        const query = submitted.fields.getTextInputValue("query").trim();

        if (/^\d{15,}$/.test(query)) {
          await banTarget(submitted, message, query);
          return;
        }

        const results = await message.guild.members.search({ query, limit: 25 }).catch(() => null);
        if (!results || results.size === 0) {
          await submitted.reply({ embeds: [buildStatusEmbed("error", `Aucun membre trouvé pour "${query}".`)], ephemeral: true });
          return;
        }
        if (results.size === 1) {
          await banTarget(submitted, message, results.first().id);
          return;
        }

        const candidates = [...results.values()].map((m) => ({
          label: m.user.tag,
          value: m.id,
          description: m.nickname ? `Surnom : ${m.nickname}` : undefined,
        }));
        await submitted.update(buildPickPanel("Zinki Assassini", candidates, "zinki_pick"));
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "zinki_pick") {
        await banTarget(i, message, i.values[0]);
        return;
      }
    } catch (err) {
      console.error("[banPanel] Erreur dans le panel Zinki Assassini :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      panelMessage.edit({ components: [] }).catch(() => {});
    }
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
    description: "Membre débanni depuis la recherche.",
    actor: message.author,
    fields: [{ name: "Cible", value: target ? `${target.user.tag} (${targetId})` : `<@${targetId}>`, inline: true }],
  });
}

/**
 * Ouvre un panel pour débannir un membre par recherche (`.unban` sans
 * argument, réservé aux administrateurs — la vérification se fait avant
 * l'appel de cette fonction). Recherche parmi les membres actuellement
 * bannis (pseudo/nom/ID) plutôt que d'en afficher la liste complète.
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

  const panelMessage = await message.reply(
    buildSearchPanel(
      "Zinki Assassini",
      `Clique pour rechercher qui débannir parmi les **${bans.size}** membre(s) banni(s) (pseudo, nom ou ID).`,
      "unban_search_open"
    )
  );

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isButton() && i.customId === "unban_search_open") {
        await i.showModal(buildSearchModal("unban_search_modal", "Zinki Assassini — Rechercher"));

        let submitted;
        try {
          submitted = await i.awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === "unban_search_modal" && m.user.id === message.author.id,
          });
        } catch {
          return;
        }

        const query = submitted.fields.getTextInputValue("query").trim().toLowerCase();
        const matches = /^\d{15,}$/.test(query)
          ? [...bans.values()].filter((b) => b.user.id === query)
          : [...bans.values()].filter(
              (b) => b.user.tag.toLowerCase().includes(query) || b.user.username.toLowerCase().includes(query)
            );

        if (matches.length === 0) {
          await submitted.reply({
            embeds: [buildStatusEmbed("error", `Aucun membre banni trouvé pour "${query}".`)],
            ephemeral: true,
          });
          return;
        }
        if (matches.length === 1) {
          await unbanTarget(submitted, message, matches[0].user.id, matches[0]);
          return;
        }

        const candidates = matches.slice(0, 25).map((b) => ({
          label: b.user.tag,
          value: b.user.id,
          description: b.reason || undefined,
        }));
        await submitted.update(buildPickPanel("Zinki Assassini", candidates, "unban_pick"));
        return;
      }

      if (i.isStringSelectMenu() && i.customId === "unban_pick") {
        const target = bans.get(i.values[0]);
        await unbanTarget(i, message, i.values[0], target);
        return;
      }
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
