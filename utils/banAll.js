const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const accessStore = require("./accessStore");
const { refusalReason, card } = require("./banPanel");

const ID = "banall";

// Même mécanique que le panneau de bannissement simple : la demande vit en
// mémoire derrière un jeton court, les identifiants d'interaction Discord
// étant plafonnés à 100 caractères.
const pending = new Map();
const PENDING_TTL_MS = 15 * 60 * 1000;

// Discord limite fortement les bannissements successifs. Une pause entre
// chaque évite de saturer la file de requêtes et de voir la commande échouer
// en masse sur un gros serveur.
const DELAY_BETWEEN_BANS_MS = 1100;

// Le message de suivi n'est réécrit que tous les N bannissements : l'éditer à
// chaque fois déclencherait sa propre limite de débit.
const PROGRESS_EVERY = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Qui a le droit de lancer un ban de masse : le propriétaire du bot, le
 * propriétaire du serveur, et les membres explicitement autorisés. Le rang
 * sys ne suffit PAS (voir NO_SYS_INHERIT dans utils/accessStore.js).
 */
function canBanAll(guild, userId) {
  return userId === guild.ownerId || accessStore.isAllowed("banall", userId);
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
  if (!canBanAll(message.guild, message.author.id)) return;

  const reason = args.join(" ").trim();

  await message.reply(card("Ban de masse", "Analyse des membres du serveur en cours…"));

  // Le cache ne contient pas forcément tout le monde : on force la liste
  // complète, sans quoi le décompte annoncé serait faux.
  await message.guild.members.fetch().catch(() => null);
  const targets = bannableMembers(message.guild, message.author.id);

  if (!targets.length) {
    return message.channel.send(card("Ban de masse", "Aucun membre ne peut être banni."));
  }

  const minutes = Math.ceil((targets.length * DELAY_BETWEEN_BANS_MS) / 60000);
  const token = rememberRequest({ actorId: message.author.id, reason, count: targets.length });

  await message.channel.send(
    card(
      "Confirmer le ban de masse",
      [
        `**${targets.length}** membre(s) seront bannis de **${message.guild.name}**.`,
        `Raison : ${reason || "*aucune*"}`,
        "",
        `Durée estimée : environ **${minutes} minute(s)**, Discord limitant le rythme des bannissements.`,
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

  if (!canBanAll(interaction.guild, interaction.user.id)) {
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
  const targets = bannableMembers(guild, request.actorId);
  await interaction.update(card("Ban de masse en cours", `0 / ${targets.length}…`));

  let done = 0;
  let failed = 0;

  for (const member of targets) {
    // Revérifié membre par membre : la liste a pu être établie il y a
    // plusieurs minutes, des rôles ont pu changer entre-temps.
    if (refusalReason(guild, member) !== null) {
      failed += 1;
      continue;
    }
    try {
      await member.ban({ reason: request.reason || `Ban de masse — par ${interaction.user.tag}` });
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

  console.log(`[banall] ${done} banni(s), ${failed} échec(s) par ${interaction.user.tag} sur "${guild.name}"`);
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
