const {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
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
const { carteSanctionMessage, carteConfirmationFichier } = require("./actionCard");
const { botAndRankRefusal, checkHierarchy, checkBotPermission, report } = require("./moderation/actions");

const ID = "ban";

// Les identifiants d'interaction Discord sont plafonnés à 100 caractères :
// y glisser la raison ferait rejeter le panneau dès qu'elle est un peu
// longue. On garde donc la demande en mémoire, désignée par un jeton court.
// Une purge au-delà d'une heure évite que la table ne grossisse indéfiniment
// à cause de panneaux jamais confirmés.
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
 * bannir : la situation peut changer entre les deux. Délègue les règles
 * communes (permissions du bot mises à part) à
 * utils/moderation/actions.js::botAndRankRefusal — pas de duplication entre
 * ce fichier et le nouveau système (banAll.js applique ceci en masse, sans
 * "acteur" précis, d'où l'absence de vérification de hiérarchie MODÉRATEUR
 * ici ; &ban/&unban l'ajoutent séparément via checkHierarchy, voir plus bas).
 * @returns {string|null} le motif du refus, ou null si le bannissement est possible
 */
function refusalReason(guild, target) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    return "Il me manque la permission **Bannir des membres**.";
  }
  return botAndRankRefusal(guild, target);
}

function card(title, body, rows = []) {
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

/** Panneau de confirmation pour une cible précise. */
function buildConfirmPanel(target, actorId, reason) {
  const token = rememberRequest({ actorId, reason, targetId: target.id });
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ID}:go:${token}`).setLabel("Bannir").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`${ID}:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
  );

  // Carte dessinée plutôt qu'un pavé de texte : c'est la confirmation la plus
  // lourde de conséquences du bot, elle doit se lire d'un coup d'œil. Repli
  // sur le texte si le rendu échoue — sans confirmation affichée, le
  // bannissement deviendrait impossible à lancer.
  const fichier = carteConfirmationFichier(
    {
      titre: "Confirmer le bannissement",
      couleur: "#ff6b6b",
      lignes: [
        { label: "Membre", valeur: target.user.tag },
        { label: "Identifiant", valeur: target.id },
        { label: "Raison", valeur: reason || "aucune" },
      ],
      avertissement: "Irréversible depuis Discord sans débannissement manuel.",
    },
    "confirmation-ban.png"
  );
  if (fichier) {
    const container = new ContainerBuilder().setAccentColor(0x2c2f5c);
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL("attachment://confirmation-ban.png"))
    );
    container.addActionRowComponents(boutons);
    return { flags: MessageFlags.IsComponentsV2, components: [container], files: [fichier] };
  }

  return card(
    "Confirmer le bannissement",
    [
      `Membre : **${target.user.tag}** (<@${target.id}>)`,
      `Raison : ${reason || "*aucune*"}`,
      "",
      "Cette action est irréversible depuis Discord sans débannissement manuel.",
    ].join("\n"),
    [boutons]
  );
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
 * &ban [@membre | id] [raison] — accordée par le rang sys ou par la clé de
 * permission "moderation.ban" (rôle ou octroi individuel, voir
 * utils/permissions/engine.js), silence complet pour les autres. Sans
 * cible, affiche un menu de sélection ; avec une cible, saute directement à
 * la confirmation.
 */
async function handleBan(client, message, args) {
  if (!can(message.member, "moderation.ban")) return;

  const { targetId, reason } = parseTarget(message, args);

  if (!targetId) {
    // Plus de menu « Choisis le membre à bannir » : la cible se donne par
    // mention ou par identifiant, comme pour toutes les autres commandes de
    // modération (demande explicite). La confirmation, elle, reste — c'est
    // elle qui protège d'un bannissement involontaire, pas le sélecteur.
    return message.reply(card("Bannir un membre", "Indique la cible : `ban @membre|id [raison]`."));
  }

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    return message.reply(card("Membre introuvable", "Ce membre n'est pas sur le serveur."));
  }

  const refusal =
    checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers") ||
    checkHierarchy(message.guild, message.member, target);
  if (refusal) return message.reply(card("Bannissement impossible", refusal));

  return message.reply(buildConfirmPanel(target, message.author.id, reason));
}

/**
 * &unban [id] — sans argument, propose la liste des bannis. Aucune
 * confirmation : contrairement au bannissement, l'action se défait d'elle-même
 * en rebannissant.
 */
async function handleUnban(client, message, args) {
  if (!can(message.member, "moderation.unban")) return;

  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    return message.reply(card("Action impossible", "Il me manque la permission **Bannir des membres**."));
  }

  const explicitId = args.join(" ").match(/\d{15,25}/)?.[0];

  if (explicitId) {
    const existing = await message.guild.bans.fetch(explicitId).catch(() => null);
    if (!existing) {
      return message.reply(card("Introuvable", "Cet identifiant ne figure pas dans la liste des bannis."));
    }
    try {
      await message.guild.bans.remove(explicitId, `Débannissement par ${message.author.tag}`);
      await report(client, {
        guildId: message.guild.id,
        category: "moderation",
        title: "Débannissement",
        fields: [{ label: "Cible", value: `<@${existing.user.id}> (${existing.user.id})` }],
        action: "unban",
        targetId: existing.user.id,
        targetTag: existing.user.tag,
        moderator: message.author,
        channelId: message.channel.id,
      });
      return message.reply(card("Membre débanni", `**${existing.user.tag}** peut de nouveau rejoindre le serveur.`));
    } catch (err) {
      console.error("[unban] échec :", err);
      return message.reply(card("Action impossible", `Discord a refusé : ${err.message}`));
    }
  }

  const bans = await message.guild.bans.fetch().catch(() => null);
  if (!bans || bans.size === 0) {
    return message.reply(card("Aucun banni", "Personne n'est banni de ce serveur."));
  }

  // Un menu déroulant ne dépasse pas 25 options : au-delà, il faut passer par
  // l'identifiant.
  const shown = [...bans.values()].slice(0, 25);
  const extra = bans.size > shown.length ? `\n\n${bans.size - shown.length} autre(s) — utilise \`unban <id>\`.` : "";

  return message.reply(
    card("Débannir un membre", `**${bans.size}** membre(s) banni(s).${extra}`, [
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

  // Le panneau reste cliquable dans le salon : les droits ET l'identité de
  // l'auteur sont revérifiés à CHAQUE clic — ban et unban ont chacun leur
  // propre clé, le menu de débannissement est donc vérifié séparément.
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
        category: "moderation",
        title: "Débannissement",
        fields: [{ label: "Cible", value: `<@${userId}> (${userId})` }],
        action: "unban",
        targetId: userId,
        targetTag: banned?.user.tag || null,
        moderator: interaction.user,
        channelId: interaction.channelId,
      });
      return interaction.update(
        card("Membre débanni", `**${banned?.user.tag || userId}** peut de nouveau rejoindre le serveur.`)
      );
    } catch (err) {
      console.error("[unban] échec :", err);
      return interaction.update(card("Action impossible", `Discord a refusé : ${err.message}`));
    }
  }

  if (!can(interaction.member, "moderation.ban")) {
    return interaction.reply({ content: "Tu n'as pas accès à cette commande.", flags: MessageFlags.Ephemeral });
  }

  const request = pending.get(token);
  if (!request) {
    return interaction.update(card("Panneau expiré", "Relance la commande pour recommencer."));
  }
  if (interaction.user.id !== request.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }

  if (action === "no") {
    pending.delete(token);
    return interaction.update(card("Bannissement annulé", null));
  }

  // Le choix du membre par menu n'existe plus : la cible se donne par mention
  // ou identifiant. Un vieux message encore affiché peut toutefois envoyer un
  // "pick" — on l'ignore plutôt que de rouvrir un chemin retiré.
  if (action === "pick") return undefined;

  if (action === "go") {
    const target = await interaction.guild.members.fetch(request.targetId).catch(() => null);
    if (!target) return interaction.update(card("Membre introuvable", "Ce membre n'est plus sur le serveur."));

    // Revérifié juste avant l'action : le membre a pu changer de rôle depuis
    // l'affichage du panneau.
    const refusal =
      checkBotPermission(interaction.guild, PermissionFlagsBits.BanMembers, "BanMembers") ||
      checkHierarchy(interaction.guild, interaction.member, target);
    if (refusal) return interaction.update(card("Bannissement impossible", refusal));

    // Consommé avant l'appel : le jeton ne doit pas pouvoir servir deux fois,
    // même si quelqu'un clique frénétiquement sur le bouton.
    pending.delete(token);

    const tag = target.user.tag;
    const reason = request.reason;
    try {
      await target.ban({ reason: reason || `zinki assasini — par ${interaction.user.tag}` });
      console.log(`[assasini] ${tag} banni par ${interaction.user.tag} sur "${interaction.guild.name}"`);
      await report(interaction.client, {
        guildId: interaction.guild.id,
        category: "moderation",
        title: "Bannissement",
        fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
        action: "ban",
        targetId: target.id,
        targetTag: tag,
        moderator: interaction.user,
        reason,
        channelId: interaction.channelId,
      });
      // Carte d'action en image ; `attachments: []` parce qu'on ÉDITE le
      // message de confirmation — sans ça Discord garderait l'ancienne pièce
      // jointe en plus. Repli sur la carte texte si le rendu échoue : le
      // bannissement, lui, a déjà eu lieu.
      const carte = await carteSanctionMessage({
        action: "ban",
        cible: target,
        moderateur: interaction.user,
        raison: reason,
        duree: "Définitif",
        serveur: interaction.guild.name,
      });
      if (carte) {
        try {
          return await interaction.update({ ...carte, components: [], embeds: [], content: "", attachments: [] });
        } catch (err) {
          // Typiquement : permission « Joindre des fichiers » absente. Le
          // membre est DÉJÀ banni — il faut donc quand même confirmer.
          console.error(`[banPanel] carte non envoyée (permission « Joindre des fichiers » ?) : ${err.message}`);
        }
      }
      return interaction.update(
        card("Membre banni", `**${tag}** a été banni.${reason ? `\nRaison : ${reason}` : ""}`)
      );
    } catch (err) {
      console.error("[assasini] échec du bannissement :", err);
      return interaction.update(card("Bannissement impossible", `Discord a refusé : ${err.message}`));
    }
  }
}

module.exports = { handleBan, handleUnban, handleBanInteraction, refusalReason, card, ID };
