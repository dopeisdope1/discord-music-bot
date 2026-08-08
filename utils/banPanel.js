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

const PANEL_TIMEOUT_MS = 60_000;

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
 * Ouvre le panel "Zinki Assassini" (`-ban`, réservé aux administrateurs — la
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
    if (i.user.id !== message.author.id) {
      await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
      return;
    }

    const targetId = i.values[0];

    if (targetId === message.author.id) {
      await i.update({
        embeds: [buildStatusEmbed("error", "Tu ne peux pas te bannir toi-même.")],
        components: [],
      });
      return;
    }

    if (targetId === message.client.user.id) {
      await i.update({
        embeds: [buildStatusEmbed("error", "Je ne vais pas me bannir moi-même.")],
        components: [],
      });
      return;
    }

    // Accuse réception tout de suite (dans les 3s imposées par Discord) : le
    // fetch du membre + le ban lui-même sont de vraies requêtes réseau qui
    // peuvent facilement dépasser ce délai, d'où le "n'a pas répondu à temps".
    await i.deferUpdate();

    const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
    if (targetMember && !targetMember.bannable) {
      await i.editReply({
        embeds: [buildStatusEmbed("error", "Je ne peux pas bannir ce membre (rôle trop élevé ou permissions insuffisantes).")],
        components: [],
      });
      return;
    }

    const banResult = await message.guild.members
      .ban(targetId, { reason: `Zinki Assassini — banni par ${message.author.tag}` })
      .catch((err) => {
        console.error(err);
        return null;
      });

    if (!banResult) {
      await i.editReply({
        embeds: [
          buildStatusEmbed(
            "error",
            `Impossible de bannir ${targetMember ? targetMember.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`
          ),
        ],
        components: [],
      });
      return;
    }

    await i.editReply({
      embeds: [
        buildStatusEmbed(
          "success",
          `${targetMember ? targetMember.user.tag : `<@${targetId}>`} a été banni — ${randomClearJoke()}`,
          { title: "Zinki Assassini" }
        ),
      ],
      components: [],
    });
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      panelMessage.edit({ components: [] }).catch(() => {});
    }
  });
}

/**
 * Débannit directement un membre par ID (`-unban <id>`).
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
}

/**
 * Ouvre un panel listant les membres actuellement bannis, pour en débannir un
 * (`-unban` sans argument, réservé aux administrateurs — la vérification se
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
        bans.size > 25 ? ` (${bans.size} bannis au total, 25 premiers affichés — utilise \`-unban <id>\` pour les autres)` : ""
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
      await i.editReply({
        embeds: [
          buildStatusEmbed("error", `Impossible de débannir ${target ? target.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`),
        ],
        components: [],
      });
      return;
    }

    await i.editReply({
      embeds: [
        buildStatusEmbed(
          "success",
          `${target ? target.user.tag : `<@${targetId}>`} a été débanni — ${randomClearJoke()}`
        ),
      ],
      components: [],
    });
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      panelMessage.edit({ components: [] }).catch(() => {});
    }
  });
}

module.exports = { handleBanPanel, handleUnbanPanel, unbanById };
