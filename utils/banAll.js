const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { can } = require("./permissions/engine");
const { refusalReason, card } = require("./banPanel");
const { report } = require("./moderation/actions");

const ID = "banall";

// Même mécanique que le panneau de bannissement simple : la demande vit en
// mémoire derrière un jeton court, les identifiants d'interaction Discord
// étant plafonnés à 100 caractères.
const pending = new Map();
const PENDING_TTL_MS = 15 * 60 * 1000;

// Discord bannit jusqu'à 200 membres par requête via son API de masse. C'est
// l'écart entre quelques secondes et plusieurs heures : bannir un par un
// impose une pause d'environ une seconde à chaque fois pour ne pas se faire
// limiter.
const BULK_CHUNK = 200;

// Repli quand l'API de masse n'est pas utilisable (voir canBulkBan) : on
// bannit un par un, avec une pause pour rester sous la limite de débit.
const DELAY_BETWEEN_BANS_MS = 1100;
const PROGRESS_EVERY = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * L'API de masse exige "Bannir des membres" ET "Gérer le serveur", là où le
 * bannissement simple se contente de la première. Sans les deux, on retombe
 * sur la boucle classique.
 */
function canBulkBan(guild) {
  return guild.members.me.permissions.has([
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageGuild,
  ]);
}

const chunk = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/**
 * Qui a le droit de lancer un ban de masse : le propriétaire du bot, le
 * propriétaire du serveur, et les membres explicitement autorisés. Le rang
 * sys ne suffit PAS (voir NO_SYS_INHERIT dans utils/accessStore.js et
 * "moderation.banall" dans utils/permissions/catalog.js, jamais octroyable
 * par rôle — engine.can() applique cette règle telle quelle).
 */
function canBanAll(guild, member) {
  return member.id === guild.ownerId || can(member, "moderation.banall");
}

function rememberRequest(data) {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  pending.set(token, { ...data, at: now });
  return token;
}

/** Membres réellement bannissables, une fois tous les protégés écartés. */
function bannableMembers(guild, actorId) {
  return [...guild.members.cache.values()].filter(
    (member) => !member.user.bot && member.id !== actorId && refusalReason(guild, member) === null
  );
}

async function handleBanAll(client, message, args) {
  if (!canBanAll(message.guild, message.member)) return;

  const reason = args.join(" ").trim();

  await message.reply(card("Ban de masse", "Analyse des membres du serveur en cours…"));

  // Le cache ne contient pas forcément tout le monde : on force la liste
  // complète, sans quoi le décompte annoncé serait faux.
  await message.guild.members.fetch().catch(() => null);
  const targets = bannableMembers(message.guild, message.author.id);

  if (!targets.length) {
    return message.channel.send(card("Ban de masse", "Aucun membre ne peut être banni."));
  }

  // L'estimation dépend entièrement de la méthode disponible : 200 membres
  // par requête contre un seul par seconde, l'écart se compte en heures.
  const bulk = canBulkBan(message.guild);
  const estimate = bulk
    ? `environ **${Math.max(1, Math.ceil((targets.length / BULK_CHUNK) * 2))} seconde(s)**, par lots de ${BULK_CHUNK}`
    : `environ **${Math.ceil((targets.length * DELAY_BETWEEN_BANS_MS) / 60000)} minute(s)** — ` +
      "donne-moi la permission **Gérer le serveur** pour que ce soit quasi instantané";

  const token = rememberRequest({ actorId: message.author.id, reason, count: targets.length });

  await message.channel.send(
    card(
      "Confirmer le ban de masse",
      [
        `**${targets.length}** membre(s) seront bannis de **${message.guild.name}**.`,
        `Raison : ${reason || "*aucune*"}`,
        "",
        `Durée estimée : ${estimate}.`,
        "Sont épargnés : toi, le propriétaire du serveur, les bots, les propriétaires du bot,",
        "les membres de rang sys, et ceux dont le rôle dépasse le mien.",
        "",
        "**Cette action est irréversible.**",
      ].join("\n"),
      [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:go:${token}`)
            .setLabel(`Bannir ${targets.length} membre(s)`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${ID}:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
        ),
      ]
    )
  );
}

async function handleBanAllInteraction(interaction) {
  const [, action, token] = interaction.customId.split(":");

  if (!canBanAll(interaction.guild, interaction.member)) {
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
    return interaction.update(card("Ban de masse annulé", null));
  }

  if (action !== "go") return;

  // Consommé avant de commencer : un second clic ne doit pas relancer une
  // opération déjà en cours.
  pending.delete(token);

  const guild = interaction.guild;
  const reason = request.reason || `Ban de masse — par ${interaction.user.tag}`;

  // Revérifié maintenant : la liste affichée peut dater de plusieurs minutes,
  // des rôles ont pu changer entre-temps.
  const targets = bannableMembers(guild, request.actorId);
  await interaction.update(card("Ban de masse en cours", `0 / ${targets.length}…`));

  let done = 0;
  let failed = 0;

  if (canBulkBan(guild)) {
    const groups = chunk(targets.map((m) => m.id), BULK_CHUNK);
    for (const [index, ids] of groups.entries()) {
      try {
        const result = await guild.bans.bulkCreate(ids, { reason });
        done += result.bannedUsers.length;
        failed += result.failedUsers.length;
      } catch (err) {
        failed += ids.length;
        console.error("[banall] échec d'un lot :", err.message);
      }
      if (index < groups.length - 1) {
        await interaction.message
          .edit(card("Ban de masse en cours", `${done} / ${targets.length}…`))
          .catch(() => {});
      }
    }
  } else {
    // Repli sans "Gérer le serveur" : un par un, donc bien plus lent.
    for (const member of targets) {
      if (refusalReason(guild, member) !== null) {
        failed += 1;
        continue;
      }
      try {
        await member.ban({ reason });
        done += 1;
      } catch (err) {
        failed += 1;
        console.error(`[banall] échec sur ${member.user.tag} :`, err.message);
      }

      if ((done + failed) % PROGRESS_EVERY === 0) {
        await interaction.message
          .edit(card("Ban de masse en cours", `${done} / ${targets.length}…`))
          .catch(() => {});
      }
      await sleep(DELAY_BETWEEN_BANS_MS);
    }
  }

  console.log(`[banall] ${done} banni(s), ${failed} échec(s) par ${interaction.user.tag} sur "${guild.name}"`);

  // Une seule entrée récapitulative plutôt que ${done} entrées individuelles :
  // une recherche "historique de modération" par cible n'a pas de sens pour
  // un ban de masse, et ${done} lignes identiques n'aideraient personne.
  if (done > 0) {
    await report(interaction.client, {
      guildId: guild.id,
      category: "moderation",
      color: 0xed4245,
      description: `🔨 **Ban de masse** — **${done}** membre(s) banni(s)${failed ? `, ${failed} échec(s)` : ""}${reason ? `\n> Raison : ${reason}` : ""}`,
      action: "banall",
      targetId: null,
      targetTag: `${done} membre(s)`,
      moderator: interaction.user,
      reason,
      channelId: interaction.channelId,
      extra: { done, failed },
    });
  }

  await interaction.message
    .edit(
      card(
        "Ban de masse terminé",
        `**${done}** membre(s) banni(s).${failed ? `\n${failed} échec(s).` : ""}`
      )
    )
    .catch(() => {});
}

module.exports = { handleBanAll, handleBanAllInteraction, canBanAll, ID };
