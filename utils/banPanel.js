const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
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

function buildZinkiAssassiniPanel() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Zinki Assassini\n> Choisis qui bannir du serveur.")
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("zinki_assassini_select").setPlaceholder("Choisir un membre à bannir")
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Ouvre le panel "Zinki Assassini" (`.ban`, réservé aux administrateurs — la
 * vérification se fait avant l'appel de cette fonction).
 * @param {import('discord.js').Message} message
 */
async function handleBanPanel(message) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    return;
  }

  const panelMessage = await message.reply(buildZinkiAssassiniPanel());
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS, max: 1 });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      const targetId = i.values[0];

      if (targetId === message.author.id) {
        await i.update(buildStatusPanel("Tu ne peux pas te bannir toi-même."));
        return;
      }

      if (targetId === message.client.user.id) {
        await i.update(buildStatusPanel("Je ne vais pas me bannir moi-même."));
        return;
      }

      // Accuse réception tout de suite (dans les 3s imposées par Discord) : le
      // fetch du membre + le ban lui-même sont de vraies requêtes réseau qui
      // peuvent facilement dépasser ce délai, d'où le "n'a pas répondu à temps".
      await i.deferUpdate();

      const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
      if (targetMember && !targetMember.bannable) {
        await i.editReply(
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
        await i.editReply(
          buildStatusPanel(
            `Impossible de bannir ${targetMember ? targetMember.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`
          )
        );
        return;
      }

      await i.editReply(
        buildStatusPanel(
          `${targetMember ? targetMember.user.tag : `<@${targetId}>`} a été banni — ${randomClearJoke()}`
        )
      );
      sendLog(
        message.client,
        message.guild.id,
        "moderation",
        `**${message.author.tag}** a banni **${targetMember ? targetMember.user.tag : targetId}** via Zinki Assassini.`
      );
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
  sendLog(message.client, message.guild.id, "moderation", `**${message.author.tag}** a débanni <@${userId}> (par ID).`);
}

/**
 * Ouvre un panel listant les membres actuellement bannis, pour en débannir un
 * (`.unban` sans argument, réservé aux administrateurs — la vérification se
 * fait avant l'appel de cette fonction).
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
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Débannir un membre\n> Choisis qui débannir${
        bans.size > 25 ? ` (${bans.size} bannis au total, 25 premiers affichés — utilise \`.unban <id>\` pour les autres)` : ""
      }.`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("unban_select")
        .setPlaceholder("Choisir un membre à débannir")
        .addOptions(
          entries.map((ban) => ({
            label: ban.user.tag.slice(0, 100),
            value: ban.user.id,
            description: ban.reason ? ban.reason.slice(0, 100) : undefined,
          }))
        )
    )
  );

  const panelMessage = await message.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS, max: 1 });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      await i.deferUpdate();

      const targetId = i.values[0];
      const target = entries.find((ban) => ban.user.id === targetId);

      const result = await message.guild.bans
        .remove(targetId, `Débanni par ${message.author.tag}`)
        .catch((err) => {
          console.error(err);
          return null;
        });

      if (!result) {
        await i.editReply(
          buildStatusPanel(
            `Impossible de débannir ${target ? target.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`
          )
        );
        return;
      }

      await i.editReply(
        buildStatusPanel(`${target ? target.user.tag : `<@${targetId}>`} a été débanni — ${randomClearJoke()}`)
      );
      sendLog(
        message.client,
        message.guild.id,
        "moderation",
        `**${message.author.tag}** a débanni **${target ? target.user.tag : targetId}**.`
      );
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
