const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const accessStore = require("./accessStore");

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

// "zinki assasini", avec la double consonne tolérée dans les deux sens, et le
// reste de la ligne (mention, identifiant, raison) capturé à part.
const TRIGGER_RE = /^zinki\s+assass?ini\b\s*(.*)$/i;

/**
 * Raisons de refus, vérifiées AVANT d'afficher le panneau comme avant de
 * bannir : la situation peut changer entre les deux.
 * @returns {string|null} le motif du refus, ou null si le bannissement est possible
 */
function refusalReason(guild, target) {
  const me = guild.members.me;

  if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
    return "Il me manque la permission **Bannir des membres**.";
  }
  if (target.id === guild.ownerId) return "Impossible de bannir le propriétaire du serveur.";
  if (target.id === me.id) return "Je ne peux pas me bannir moi-même.";
  if (accessStore.isOwner(target.id)) return "Ce membre est propriétaire du bot.";
  if (accessStore.isAllowed("sys", target.id)) return "Ce membre a le rang sys, retire-le lui d'abord.";
  if (me.roles.highest.position <= target.roles.highest.position) {
    return "Mon rôle est trop bas pour bannir ce membre — place-le plus haut dans la liste des rôles.";
  }
  return null;
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

/** Panneau de sélection : aucune cible n'a été donnée dans le message. */
function buildPickPanel(actorId, reason) {
  const token = rememberRequest({ actorId, reason });
  return card(
    "Bannir un membre",
    reason ? `Raison : ${reason}` : "Choisis le membre à bannir dans le menu ci-dessous.",
    [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`${ID}:pick:${token}`)
          .setPlaceholder("Choisis le membre à bannir")
      ),
    ]
  );
}

/** Panneau de confirmation pour une cible précise. */
function buildConfirmPanel(target, actorId, reason) {
  const token = rememberRequest({ actorId, reason, targetId: target.id });
  return card(
    "Confirmer le bannissement",
    [
      `Membre : **${target.user.tag}** (<@${target.id}>)`,
      `Raison : ${reason || "*aucune*"}`,
      "",
      "Cette action est irréversible depuis Discord sans débannissement manuel.",
    ].join("\n"),
    [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:go:${token}`).setLabel("Bannir").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${ID}:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
      ),
    ]
  );
}

/**
 * Déclencheur sans préfixe "zinki assasini", à appeler depuis messageCreate.
 * Réservé au rang sys : silence complet pour les autres, pour ne pas révéler
 * l'existence de la commande.
 * @returns {Promise<boolean>} true si le message était le déclencheur
 */
async function handleAssassini(client, message) {
  if (message.author.bot || !message.guild) return false;

  const match = message.content.trim().match(TRIGGER_RE);
  if (!match) return false;
  if (!accessStore.isAllowed("sys", message.author.id)) return true;

  const rest = match[1].trim();
  const mentioned = message.mentions.users?.first();
  const idMatch = rest.match(/\d{15,25}/);
  const targetId = mentioned?.id || idMatch?.[0] || null;

  // Ce qui reste une fois la cible retirée devient la raison.
  const reason = rest
    .replace(/<@!?\d+>/g, "")
    .replace(/\d{15,25}/, "")
    .trim();

  if (!targetId) {
    await message.reply(buildPickPanel(message.author.id, reason));
    return true;
  }

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    await message.reply(card("Membre introuvable", "Ce membre n'est pas sur le serveur."));
    return true;
  }

  const refusal = refusalReason(message.guild, target);
  if (refusal) {
    await message.reply(card("Bannissement impossible", refusal));
    return true;
  }

  await message.reply(buildConfirmPanel(target, message.author.id, reason));
  return true;
}

async function handleBanInteraction(interaction) {
  const [, action, token] = interaction.customId.split(":");

  // Le panneau reste cliquable dans le salon : le rang ET l'identité de
  // l'auteur sont revérifiés à chaque clic.
  if (!accessStore.isAllowed("sys", interaction.user.id)) {
    return interaction.reply({ content: "Tu n'as pas accès à cette commande.", flags: MessageFlags.Ephemeral });
  }

  const request = pending.get(token);
  if (!request) {
    return interaction.update(card("Panneau expiré", "Relance `zinki assasini` pour recommencer."));
  }
  if (interaction.user.id !== request.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }

  if (action === "no") {
    pending.delete(token);
    return interaction.update(card("Bannissement annulé", null));
  }

  if (action === "pick") {
    const target = await interaction.guild.members.fetch(interaction.values[0]).catch(() => null);
    if (!target) return interaction.update(card("Membre introuvable", "Ce membre n'est plus sur le serveur."));

    const refusal = refusalReason(interaction.guild, target);
    if (refusal) return interaction.update(card("Bannissement impossible", refusal));

    pending.delete(token);
    return interaction.update(buildConfirmPanel(target, request.actorId, request.reason));
  }

  if (action === "go") {
    const target = await interaction.guild.members.fetch(request.targetId).catch(() => null);
    if (!target) return interaction.update(card("Membre introuvable", "Ce membre n'est plus sur le serveur."));

    // Revérifié juste avant l'action : le membre a pu changer de rôle depuis
    // l'affichage du panneau.
    const refusal = refusalReason(interaction.guild, target);
    if (refusal) return interaction.update(card("Bannissement impossible", refusal));

    // Consommé avant l'appel : le jeton ne doit pas pouvoir servir deux fois,
    // même si quelqu'un clique frénétiquement sur le bouton.
    pending.delete(token);

    const tag = target.user.tag;
    const reason = request.reason;
    try {
      await target.ban({ reason: reason || `zinki assasini — par ${interaction.user.tag}` });
      console.log(`[assasini] ${tag} banni par ${interaction.user.tag} sur "${interaction.guild.name}"`);
      return interaction.update(
        card("Membre banni", `**${tag}** a été banni.${reason ? `\nRaison : ${reason}` : ""}`)
      );
    } catch (err) {
      console.error("[assasini] échec du bannissement :", err);
      return interaction.update(card("Bannissement impossible", `Discord a refusé : ${err.message}`));
    }
  }
}

module.exports = { handleAssassini, handleBanInteraction, refusalReason, card, ID };
