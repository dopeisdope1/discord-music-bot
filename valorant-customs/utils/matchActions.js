/**
 * Toutes les actions sur une partie, quel que soit le point d'entrée
 * (bouton, menu déroulant, modale ou commande slash).
 *
 * Chaque action renvoie sa réponse en éphémère : l'embed de la partie est la
 * seule source de vérité publique, on ne pollue pas le salon.
 */

const { MessageFlags } = require("discord.js");

const config = require("../config");
const store = require("./store");
const { logEvent } = require("./logger");
const { canManage, missingBotPermissions } = require("./permissions");
const { meetsMinimum, parseRank, formatRank, RANK_HELP, RANK_BY_KEY } = require("./ranks");
const {
  findTeam, isInWaitlist, isInMatch, teamIsFull, playerCount,
  removePlayer, addToTeam, addToWaitlist,
  refreshMatchMessage, announce,
} = require("./matches");
const {
  errorEmbed, successEmbed, infoEmbed,
  buildMatchEmbed, buildMatchComponents, buildWarnSelect,
  buildProfileModal, parseCustomId,
} = require("./embeds");
const {
  createTeamChannels, deleteTeamChannels, syncTeamPermissions, moveToTeamChannel,
} = require("./voice");
const warnings = require("./warnings");

const ephemeral = (embed, components = []) => ({
  embeds: [embed],
  components,
  flags: MessageFlags.Ephemeral,
});

const replyError = (interaction, message) => interaction.reply(ephemeral(errorEmbed(message)));
const replyOk = (interaction, message) => interaction.reply(ephemeral(successEmbed(message)));

// ═════════════════════════════ REJOINDRE ═════════════════════════════

async function actionJoin(interaction, match, teamNo) {
  const userId = interaction.user.id;

  if (match.status === "ended") return replyError(interaction, "Cette partie est terminée.");

  // Pas encore de profil Valorant → on ouvre la modale, puis on rejouera
  // l'action automatiquement à la validation (voir handleProfileModal).
  const profile = store.getProfile(userId);
  if (!profile) {
    if (!interaction.isMessageComponent?.()) {
      return replyError(interaction, "Renseigne d'abord ton profil avec `/profil` (pseudo Valorant + rang).");
    }
    return interaction.showModal(buildProfileModal(match.id, `join:${teamNo}`));
  }

  if (!meetsMinimum(profile.rank, match.minRank)) {
    const required = RANK_BY_KEY.get(match.minRank);
    return replyError(
      interaction,
      `Rang insuffisant : cette partie demande **${required.emoji} ${required.label}** minimum, ton profil indique ${formatRank(profile.rank)}.\n` +
      "Mets ton rang à jour avec `/profil` s'il a changé.",
    );
  }

  const currentTeam = findTeam(match, userId);
  if (currentTeam === teamNo) return replyError(interaction, `Tu es déjà dans l'**Équipe ${teamNo}**.`);
  if (teamIsFull(match, teamNo)) {
    return replyError(
      interaction,
      `L'**Équipe ${teamNo}** est complète (${match.format.perTeam}/${match.format.perTeam}). ` +
      "Utilise le bouton **Liste d'attente** pour prendre la prochaine place libre.",
    );
  }

  // Changer d'équipe alors qu'on est averti annule l'avertissement en cours.
  await warnings.cancelWarning(interaction.client, match, userId, { silent: true });

  addToTeam(match, userId, teamNo);
  store.save();
  await refreshMatchMessage(interaction.client, match);

  // Salons vocaux : accès + déplacement immédiat si la partie tourne déjà.
  if (interaction.guild) {
    if (currentTeam) await syncTeamPermissions(interaction.guild, match, currentTeam);
    await syncTeamPermissions(interaction.guild, match, teamNo);
    if (match.status === "live") await moveToTeamChannel(interaction.guild, match, teamNo, userId);
  }

  logEvent(interaction.client, "join", {
    matchId: match.id,
    description: `<@${userId}> rejoint l'Équipe ${teamNo} (${profile.riotId} · ${formatRank(profile.rank)}).`,
  });

  const suffix = currentTeam ? ` (tu as quitté l'Équipe ${currentTeam})` : "";
  return replyOk(interaction, `Tu rejoins l'**Équipe ${teamNo}**${suffix}.`);
}

// ═════════════════════════ LISTE D'ATTENTE ═════════════════════════

async function actionWaitlist(interaction, match) {
  const userId = interaction.user.id;

  if (match.status === "ended") return replyError(interaction, "Cette partie est terminée.");
  if (isInWaitlist(match, userId)) {
    const position = match.waitlist.indexOf(userId) + 1;
    return replyError(interaction, `Tu es déjà en liste d'attente (**position ${position}**). Utilise **Quitter** pour en sortir.`);
  }

  const profile = store.getProfile(userId);
  if (!profile) {
    if (!interaction.isMessageComponent?.()) {
      return replyError(interaction, "Renseigne d'abord ton profil avec `/profil` (pseudo Valorant + rang).");
    }
    return interaction.showModal(buildProfileModal(match.id, "waitlist"));
  }

  if (!meetsMinimum(profile.rank, match.minRank)) {
    const required = RANK_BY_KEY.get(match.minRank);
    return replyError(interaction, `Rang insuffisant : **${required.emoji} ${required.label}** minimum requis.`);
  }

  const previousTeam = findTeam(match, userId);
  await warnings.cancelWarning(interaction.client, match, userId, { silent: true });
  addToWaitlist(match, userId);
  store.save();
  await refreshMatchMessage(interaction.client, match);

  if (previousTeam && interaction.guild) await syncTeamPermissions(interaction.guild, match, previousTeam);

  logEvent(interaction.client, "join", {
    matchId: match.id,
    description: `<@${userId}> entre en liste d'attente (position ${match.waitlist.length}).`,
  });

  // Une place s'est libérée en quittant son équipe : on la propose tout de suite.
  if (previousTeam) await warnings.offerSpot(interaction.client, match, previousTeam);

  return replyOk(interaction, `Tu es en **liste d'attente** — position **${match.waitlist.indexOf(userId) + 1}**.`);
}

// ═══════════════════════════════ QUITTER ═══════════════════════════════

async function actionLeave(interaction, match) {
  const userId = interaction.user.id;
  if (!isInMatch(match, userId)) return replyError(interaction, "Tu ne participes pas à cette partie.");

  await warnings.cancelWarning(interaction.client, match, userId, { silent: true });
  const teamNo = removePlayer(match, userId);
  store.save();
  await refreshMatchMessage(interaction.client, match);

  if (teamNo && interaction.guild) await syncTeamPermissions(interaction.guild, match, teamNo);

  logEvent(interaction.client, "leave", {
    matchId: match.id,
    description: `<@${userId}> a quitté ${teamNo ? `l'Équipe ${teamNo}` : "la liste d'attente"}.`,
  });

  if (teamNo) {
    await announce(interaction.client, match, {
      embeds: [infoEmbed(`↩️ <@${userId}> quitte l'**Équipe ${teamNo}** — une place est libre.`)],
    });
    await warnings.offerSpot(interaction.client, match, teamNo);
  }

  return replyOk(interaction, teamNo ? `Tu as quitté l'**Équipe ${teamNo}**.` : "Tu as quitté la liste d'attente.");
}

// ═══════════════════════ LANCER / TERMINER LA PARTIE ═══════════════════════

async function actionStart(interaction, match) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un membre du staff) peut la lancer.");
  }
  if (match.status !== "waiting") return replyError(interaction, "Cette partie est déjà lancée ou terminée.");
  if (!match.teams[1].length || !match.teams[2].length) {
    return replyError(interaction, "Il faut au moins un joueur dans chaque équipe pour lancer la partie.");
  }

  const missing = missingBotPermissions(interaction.guild);
  if (missing.length) {
    return replyError(
      interaction,
      `Il me manque des permissions pour créer les salons vocaux : **${missing.join(", ")}**.\n` +
      "Ajoute-les au rôle du bot, puis relance la partie.",
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Les salons sont créés dans la catégorie configurée, sinon celle du salon
  // où la partie a été lancée.
  const parentId = interaction.channel?.parentId || null;
  const { error } = await createTeamChannels(interaction.guild, match, parentId);
  if (error) {
    return interaction.editReply({ embeds: [errorEmbed(`Création des salons vocaux impossible : ${error}`)] });
  }

  match.status = "live";
  store.save();
  await refreshMatchMessage(interaction.client, match);

  // Déplacement automatique de ceux qui sont déjà connectés quelque part.
  let moved = 0;
  for (const teamNo of [1, 2]) {
    for (const userId of match.teams[teamNo]) {
      const result = await moveToTeamChannel(interaction.guild, match, teamNo, userId);
      if (result.moved) moved += 1;
    }
  }

  await announce(interaction.client, match, {
    embeds: [
      infoEmbed([
        `${config.emojis.start} **La partie est lancée !**`,
        "",
        `${config.emojis.team1} Équipe 1 · <#${match.voice[1]}>`,
        `${config.emojis.team2} Équipe 2 · <#${match.voice[2]}>`,
        "",
        "Les joueurs déjà en vocal ont été déplacés automatiquement.",
      ].join("\n")),
    ],
  });

  logEvent(interaction.client, "start", {
    matchId: match.id,
    description: `Partie lancée par <@${interaction.user.id}> — salons vocaux créés, ${moved} joueur(s) déplacé(s).`,
  });

  return interaction.editReply({
    embeds: [successEmbed(`Partie lancée. Salons créés, **${moved}** joueur(s) déplacé(s) automatiquement.`)],
  });
}

async function actionEnd(interaction, match) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un membre du staff) peut la terminer.");
  }
  if (match.status === "ended") return replyError(interaction, "Cette partie est déjà terminée.");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  warnings.clearMatchTimers(match);
  match.warnings = {};
  match.offers = {};
  match.status = "ended";
  store.save();

  await deleteTeamChannels(interaction.client, match);
  store.save();
  await refreshMatchMessage(interaction.client, match);

  await announce(interaction.client, match, {
    embeds: [infoEmbed(`${config.emojis.end} **Partie terminée** par <@${interaction.user.id}>. Merci à tous !`)],
  });

  logEvent(interaction.client, "end", {
    matchId: match.id,
    description: `Partie terminée par <@${interaction.user.id}> (${playerCount(match)} joueur(s) inscrits).`,
  });

  return interaction.editReply({ embeds: [successEmbed("Partie terminée et salons vocaux supprimés.")] });
}

// ═════════════════════════════ AVERTIR ═════════════════════════════

/** Bouton « Avertir un joueur » → menu déroulant éphémère des joueurs. */
async function actionWarnMenu(interaction, match) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un membre du staff) peut avertir un joueur.");
  }
  const row = buildWarnSelect(match);
  if (!row) return replyError(interaction, "Aucun joueur n'est inscrit dans les équipes pour l'instant.");

  return interaction.reply(ephemeral(
    infoEmbed(`${config.emojis.warn} Sélectionne le joueur à avertir. Il aura **${Math.round(config.timings.warnMs / 1000)} secondes** pour rejoindre le vocal de son équipe.`),
    [row],
  ));
}

/** Point d'entrée commun au menu déroulant et à la commande /avertir. */
async function runWarning(interaction, match, targetId) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un membre du staff) peut avertir un joueur.");
  }

  const result = await warnings.startWarning(interaction.client, match, targetId, interaction.user.id);
  if (!result.ok) return replyError(interaction, result.error);

  const seconds = Math.round(config.timings.warnMs / 1000);
  return replyOk(
    interaction,
    `<@${targetId}> a été averti (**Équipe ${result.teamNo}**). Retrait automatique dans **${seconds} s** s'il ne rejoint pas le vocal.`,
  );
}

// ═══════════════════════ PROPOSITIONS DE PLACE ═══════════════════════

async function actionOffer(interaction, match, teamNo, candidateId, accepted) {
  if (interaction.user.id !== candidateId) {
    return replyError(interaction, "Cette proposition ne t'est pas adressée.");
  }

  const result = accepted
    ? await warnings.acceptOffer(interaction.client, match, teamNo, candidateId)
    : await warnings.declineOffer(interaction.client, match, teamNo, candidateId);

  if (!result.ok) return replyError(interaction, result.error);
  return replyOk(interaction, accepted ? `Tu rejoins l'**Équipe ${teamNo}** !` : "Tu as passé ton tour, tu restes en liste d'attente.");
}

// ═══════════════════════════ ROUTAGE ═══════════════════════════

/** Résout la partie visée par une interaction, avec message d'erreur clair. */
function resolveMatch(matchId) {
  const match = store.getMatch(matchId);
  return match || null;
}

async function handleComponent(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false; // pas une interaction du bot customs

  const match = resolveMatch(parsed.matchId);
  if (!match) {
    await replyError(interaction, "Cette partie n'existe plus (bot redémarré ou partie purgée). Crée-en une nouvelle avec `/custom`.");
    return true;
  }

  switch (parsed.action) {
    case "join":
      await actionJoin(interaction, match, Number(parsed.extra[0]));
      return true;
    case "waitlist":
      await actionWaitlist(interaction, match);
      return true;
    case "leave":
      await actionLeave(interaction, match);
      return true;
    case "start":
      await actionStart(interaction, match);
      return true;
    case "end":
      await actionEnd(interaction, match);
      return true;
    case "warn":
      await actionWarnMenu(interaction, match);
      return true;
    case "warn-select":
      await runWarning(interaction, match, interaction.values[0]);
      return true;
    case "offer-accept":
      await actionOffer(interaction, match, Number(parsed.extra[0]), parsed.extra[1], true);
      return true;
    case "offer-decline":
      await actionOffer(interaction, match, Number(parsed.extra[0]), parsed.extra[1], false);
      return true;
    default:
      return false;
  }
}

/** Modale de profil : enregistre le profil puis rejoue l'action demandée. */
async function handleProfileModal(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.action !== "profile-modal") return false;

  const riotId = interaction.fields.getTextInputValue("riotId").trim();
  const rank = parseRank(interaction.fields.getTextInputValue("rank"));

  if (!rank) {
    await replyError(interaction, `Rang non reconnu. Valeurs acceptées : ${RANK_HELP} (avec une division : « Diamant 2 »).`);
    return true;
  }

  store.setProfile(interaction.user.id, { riotId, rank });

  const match = resolveMatch(parsed.matchId);
  if (!match) {
    await replyOk(interaction, `Profil enregistré : \`${riotId}\` · ${formatRank(rank)}. En revanche, cette partie n'existe plus.`);
    return true;
  }

  // `extra` contient l'action mise en attente : "join:1" ou "waitlist".
  const [pendingAction, teamNo] = parsed.extra;
  if (pendingAction === "join") await actionJoin(interaction, match, Number(teamNo));
  else if (pendingAction === "waitlist") await actionWaitlist(interaction, match);
  else await replyOk(interaction, `Profil enregistré : \`${riotId}\` · ${formatRank(rank)}.`);

  return true;
}

module.exports = {
  actionJoin, actionWaitlist, actionLeave, actionStart, actionEnd,
  runWarning, handleComponent, handleProfileModal,
  buildMatchEmbed, buildMatchComponents,
};
