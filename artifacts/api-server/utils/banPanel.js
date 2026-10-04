const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { can } = require("./permissions/engine");
const { botAndRankRefusal, checkHierarchy, checkBotPermission, report } = require("./moderation/actions");

const ID = "ban";

// Les identifiants d'interaction Discord sont plafonnés à 100 caractères :
// y glisser la raison ferait rejeter le panneau dès qu'elle est un peu
// longue. On garde donc la demande en mémoire, désignée par un jeton court.
const pending = new Map();
const PENDING_TTL_MS = 60 * 60 * 1000;

function rememberRequest(data) {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  pending.set(token, { ...data, at: now });
  return token;
}

/**
 * Raisons de refus, vérifiées AVANT d'afficher le panneau comme avant de
 * bannir. Délègue les règles communes à utils/moderation/actions.js::
 * botAndRankRefusal (utils/banAll.js applique ceci en masse, sans "acteur"
 * précis, d'où l'absence de vérification de hiérarchie MODÉRATEUR ici).
 * @returns {string|null} le motif du refus, ou null si le bannissement est possible
 */
function refusalReason(guild, target) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    return "Il me manque la permission **Bannir des membres**.";
  }
  return botAndRankRefusal(guild, target);
}

function card(guildId, title, body, rows = []) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  if (body) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }
  if (rows.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    for (const row of rows) container.addActionRowComponents(row);
  }
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Sépare la cible (mention ou identifiant) du reste, qui devient la raison. */
function parseTarget(message, args) {
  const rest = args.join(" ").trim();
  const mentioned = message.mentions.users?.first();
  const idMatch = rest.match(/\d{15,25}/);
  return {
    targetId: mentioned?.id || idMatch?.[0] || null,
    reason: rest
      .replace(/<@!?\d+>/g, "")
      .replace(/\d{15,25}/, "")
      .trim(),
  };
}

/**
 * Bannit RÉELLEMENT, et répond par un embed simple.
 * @param {(payload: object) => Promise<any>} repondre comment répondre —
 *   `message.reply` pour une commande tapée, `interaction.update` pour un
 *   ancien panneau encore affiché.
 */
async function bannir(client, { guild, acteur, target, reason, channelId, repondre }) {
  const refusal =
    checkBotPermission(guild, PermissionFlagsBits.BanMembers, "BanMembers") || checkHierarchy(guild, acteur.member, target);
  if (refusal) return repondre(card(guild.id, "Bannissement impossible", refusal));

  const tag = target.user.tag;
  try {
    await target.ban({ reason: reason || `Banni par ${acteur.user.tag}` });
    console.log(`[ban] ${tag} banni par ${acteur.user.tag} sur "${guild.name}"`);
    await report(client, {
      guildId: guild.id,
      title: "Bannissement",
      fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
      action: "ban",
      targetId: target.id,
      targetTag: tag,
      moderator: acteur.user,
      reason,
      channelId,
    });
    return repondre(card(guild.id, "Membre banni", `**${tag}** a été banni.${reason ? `\nRaison : ${reason}` : ""}`));
  } catch (err) {
    console.error("[ban] échec du bannissement :", err);
    return repondre(card(guild.id, "Bannissement impossible", `Discord a refusé : ${err.message}`));
  }
}

/**
 * -ban [@membre | id] [raison] — accordée par le rang sys ou par la clé de
 * permission "moderation.ban" (rôle ou octroi individuel), silence complet
 * pour les autres.
 */
async function handleBan(client, message, args) {
  if (!can(message.member, "moderation.ban")) return;

  const { targetId, reason } = parseTarget(message, args);

  if (!targetId) {
    return message.reply(card(message.guild.id, "Bannir un membre", "Indique la cible : `ban @membre|id [raison]`."));
  }

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    return message.reply(card(message.guild.id, "Membre introuvable", "Ce membre n'est pas sur le serveur."));
  }

  return bannir(client, {
    guild: message.guild,
    acteur: { member: message.member, user: message.author },
    target,
    reason,
    channelId: message.channel.id,
    repondre: (payload) => message.reply(payload),
  });
}

/**
 * -unban [id] — sans argument, propose la liste des bannis.
 */
async function handleUnban(client, message, args) {
  if (!can(message.member, "moderation.unban")) return;

  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    return message.reply(card(message.guild.id, "Action impossible", "Il me manque la permission **Bannir des membres**."));
  }

  const explicitId = args.join(" ").match(/\d{15,25}/)?.[0];

  if (explicitId) {
    const existing = await message.guild.bans.fetch(explicitId).catch(() => null);
    if (!existing) {
      return message.reply(card(message.guild.id, "Introuvable", "Cet identifiant ne figure pas dans la liste des bannis."));
    }
    try {
      await message.guild.bans.remove(explicitId, `Débannissement par ${message.author.tag}`);
      await report(client, {
        guildId: message.guild.id,
        title: "Débannissement",
        fields: [{ label: "Cible", value: `<@${existing.user.id}> (${existing.user.id})` }],
        action: "unban",
        targetId: existing.user.id,
        targetTag: existing.user.tag,
        moderator: message.author,
        channelId: message.channel.id,
      });
      return message.reply(card(message.guild.id, "Membre débanni", `**${existing.user.tag}** peut de nouveau rejoindre le serveur.`));
    } catch (err) {
      console.error("[unban] échec :", err);
      return message.reply(card(message.guild.id, "Action impossible", `Discord a refusé : ${err.message}`));
    }
  }

  const bans = await message.guild.bans.fetch().catch(() => null);
  if (!bans || bans.size === 0) {
    return message.reply(card(message.guild.id, "Aucun banni", "Personne n'est banni de ce serveur."));
  }

  const shown = [...bans.values()].slice(0, 25);
  const extra = bans.size > shown.length ? `\n\n${bans.size - shown.length} autre(s) — utilise \`unban <id>\`.` : "";

  return message.reply(
    card(message.guild.id, "Débannir un membre", `**${bans.size}** membre(s) banni(s).${extra}`, [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:un:${message.author.id}`)
          .setPlaceholder("Choisis le membre à débannir")
          .addOptions(
            shown.map((b) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(b.user.tag.slice(0, 100))
                .setDescription((b.reason || "Aucune raison enregistrée").slice(0, 100))
                .setValue(b.user.id)
            )
          )
      ),
    ])
  );
}

async function handleBanInteraction(interaction) {
  const [, action, token] = interaction.customId.split(":");

  if (action === "un") {
    if (!can(interaction.member, "moderation.unban")) {
      return interaction.reply({ content: "Tu n'as pas accès à cette commande.", flags: MessageFlags.Ephemeral });
    }
    if (interaction.user.id !== token) {
      return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.values[0];
    try {
      const banned = await interaction.guild.bans.fetch(userId).catch(() => null);
      await interaction.guild.bans.remove(userId, `Débannissement par ${interaction.user.tag}`);
      await report(interaction.client, {
        guildId: interaction.guild.id,
        title: "Débannissement",
        fields: [{ label: "Cible", value: `<@${userId}> (${userId})` }],
        action: "unban",
        targetId: userId,
        targetTag: banned?.user.tag || null,
        moderator: interaction.user,
        channelId: interaction.channelId,
      });
      return interaction.update(
        card(interaction.guild.id, "Membre débanni", `**${banned?.user.tag || userId}** peut de nouveau rejoindre le serveur.`)
      );
    } catch (err) {
      console.error("[unban] échec :", err);
      return interaction.update(card(interaction.guild.id, "Action impossible", `Discord a refusé : ${err.message}`));
    }
  }

  if (!can(interaction.member, "moderation.ban")) {
    return interaction.reply({ content: "Tu n'as pas accès à cette commande.", flags: MessageFlags.Ephemeral });
  }

  const request = pending.get(token);
  if (!request) {
    return interaction.update(card(interaction.guild.id, "Panneau expiré", "Relance la commande pour recommencer."));
  }
  if (interaction.user.id !== request.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }

  if (action === "no") {
    pending.delete(token);
    return interaction.update(card(interaction.guild.id, "Bannissement annulé", null));
  }

  if (action === "go") {
    const target = await interaction.guild.members.fetch(request.targetId).catch(() => null);
    if (!target) return interaction.update(card(interaction.guild.id, "Membre introuvable", "Ce membre n'est plus sur le serveur."));

    const refusal =
      checkBotPermission(interaction.guild, PermissionFlagsBits.BanMembers, "BanMembers") ||
      checkHierarchy(interaction.guild, interaction.member, target);
    if (refusal) return interaction.update(card(interaction.guild.id, "Bannissement impossible", refusal));

    pending.delete(token);

    const tag = target.user.tag;
    const reason = request.reason;
    try {
      await target.ban({ reason: reason || `Banni par ${interaction.user.tag}` });
      console.log(`[ban] ${tag} banni par ${interaction.user.tag} sur "${interaction.guild.name}"`);
      await report(interaction.client, {
        guildId: interaction.guild.id,
        title: "Bannissement",
        fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
        action: "ban",
        targetId: target.id,
        targetTag: tag,
        moderator: interaction.user,
        reason,
        channelId: interaction.channelId,
      });
      return interaction.update(card(interaction.guild.id, "Membre banni", `**${tag}** a été banni.${reason ? `\nRaison : ${reason}` : ""}`));
    } catch (err) {
      console.error("[ban] échec du bannissement :", err);
      return interaction.update(card(interaction.guild.id, "Bannissement impossible", `Discord a refusé : ${err.message}`));
    }
  }
}

module.exports = { handleBan, handleUnban, handleBanInteraction, refusalReason, card, ID };
