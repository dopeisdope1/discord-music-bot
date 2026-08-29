/**
 * Tout le rendu visuel du bot : embeds sombres, boutons, sélecteurs, modale.
 * Aucun effet de bord ici — ce module construit des objets, rien d'autre.
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");

const config = require("../config");
const { formatRank, RANK_BY_KEY } = require("./ranks");
const store = require("./store");

// Préfixe commun à tous les customId du bot : "vc" = Valorant Custom.
// Format : vc:<action>:<matchId>[:<extra>]
const ID = "vc";
const customId = (action, matchId, extra) =>
  [ID, action, matchId, extra].filter((part) => part !== undefined && part !== null).join(":");

const parseCustomId = (raw) => {
  const [prefix, action, matchId, ...extra] = String(raw).split(":");
  return prefix === ID ? { action, matchId, extra } : null;
};

const STATUS = {
  waiting: { emoji: "🟡", label: "En attente", color: config.colors.waiting },
  live:    { emoji: "🔴", label: "En cours",   color: config.colors.live },
  ended:   { emoji: "⚫", label: "Terminée",   color: config.colors.ended },
};

// ---- Embeds génériques (réponses éphémères, erreurs...) ----

const simpleEmbed = (color, description) => new EmbedBuilder().setColor(color).setDescription(description);
const errorEmbed = (message) => simpleEmbed(config.colors.error, `❌ ${message}`);
const successEmbed = (message) => simpleEmbed(config.colors.success, `✅ ${message}`);
const infoEmbed = (message) => simpleEmbed(config.colors.base, message);

// ---- Embed principal de la partie ----

/** Une ligne de joueur : `1` @mention · `Riot#TAG` · 🟪 Diamant 2 */
function playerLine(match, userId, index) {
  const profile = store.getProfile(userId);
  const riotId = profile?.riotId ? `\`${profile.riotId}\`` : "`pseudo non renseigné`";
  const rank = formatRank(profile?.rank);
  const warning = match.warnings?.[userId];
  // Le joueur averti est signalé dans l'embed avec son compte à rebours.
  const warned = warning ? ` ${config.emojis.warn} <t:${Math.floor(warning.deadline / 1000)}:R>` : "";
  return `\`${index}\` <@${userId}> · ${riotId} · ${rank}${warned}`;
}

function teamField(match, teamNo) {
  const members = match.teams[teamNo];
  const size = match.format.perTeam;
  const emoji = teamNo === 1 ? config.emojis.team1 : config.emojis.team2;

  const lines = members.map((userId, i) => playerLine(match, userId, i + 1));
  // Les places libres sont affichées : on voit d'un coup d'œil ce qu'il manque.
  for (let i = members.length; i < size; i += 1) {
    lines.push(`\`${i + 1}\` ${config.emojis.empty} *place libre*`);
  }

  const voice = match.voice?.[teamNo] ? `\n🔊 <#${match.voice[teamNo]}>` : "";
  return {
    name: `${emoji} Équipe ${teamNo} — ${members.length}/${size}`,
    value: `${lines.join("\n")}${voice}`.slice(0, 1024),
    inline: false,
  };
}

function waitlistField(match) {
  if (!match.waitlist.length) return null;
  const lines = match.waitlist.slice(0, 10).map((userId, i) => playerLine(match, userId, i + 1));
  if (match.waitlist.length > 10) lines.push(`*… et ${match.waitlist.length - 10} autre(s)*`);
  return {
    name: `${config.emojis.waitlist} Liste d'attente — ${match.waitlist.length}`,
    value: lines.join("\n").slice(0, 1024),
    inline: false,
  };
}

function buildMatchEmbed(match) {
  const status = STATUS[match.status] || STATUS.waiting;
  const total = match.teams[1].length + match.teams[2].length;
  const capacity = match.format.perTeam * 2;

  const header = [
    `${config.emojis.host} **Hôte** · <@${match.hostId}>`,
    `🎮 **Format** · \`${match.format.label}\`${match.map ? `   ${config.emojis.map} **Map** · \`${match.map}\`` : ""}`,
  ];
  if (match.minRank) {
    const rank = RANK_BY_KEY.get(match.minRank);
    if (rank) header.push(`🏅 **Rang minimum** · ${rank.emoji} ${rank.label}`);
  }
  header.push("", `${status.emoji} **${status.label}** — ${total}/${capacity} joueur(s)`, config.separator);

  const embed = new EmbedBuilder()
    .setColor(status.color)
    .setTitle("Partie personnalisée — Valorant")
    .setDescription(header.join("\n"))
    .addFields(teamField(match, 1), teamField(match, 2))
    .setFooter({ text: `Partie #${match.id} · Salons vocaux privés créés au lancement de la partie` })
    .setTimestamp(match.createdAt);

  const waitlist = waitlistField(match);
  if (waitlist) embed.addFields(waitlist);

  if (match.status === "ended") {
    embed.addFields({
      name: config.separator,
      value: "🛑 **Cette partie est terminée.** Les salons vocaux d'équipe ont été supprimés.",
    });
  }

  return embed;
}

/** Boutons de la partie — leur état suit le statut de la partie. */
function buildMatchComponents(match) {
  if (match.status === "ended") return [];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId("join", match.id, "1"))
      .setLabel("Rejoindre Équipe 1")
      .setEmoji(config.emojis.team1)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId("join", match.id, "2"))
      .setLabel("Rejoindre Équipe 2")
      .setEmoji(config.emojis.team2)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId("waitlist", match.id))
      .setLabel("Liste d'attente")
      .setEmoji(config.emojis.waitlist)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId("leave", match.id))
      .setLabel("Quitter")
      .setEmoji(config.emojis.leave)
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder();
  if (match.status === "waiting") {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(customId("start", match.id))
        .setLabel("Lancer la partie")
        .setEmoji(config.emojis.start)
        .setStyle(ButtonStyle.Success),
    );
  }
  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(customId("warn", match.id))
      .setLabel("Avertir un joueur")
      .setEmoji(config.emojis.warn)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId("end", match.id))
      .setLabel("Terminer la partie")
      .setEmoji(config.emojis.end)
      .setStyle(ButtonStyle.Danger),
  );

  return [row1, row2];
}

// ---- Système d'avertissement ----

/** Message public d'avertissement : c'est LE message qui ping le joueur. */
function buildWarningEmbed(match, targetId, teamNo, deadline) {
  const seconds = Math.round(config.timings.warnMs / 1000);
  const voiceMention = match.voice?.[teamNo]
    ? `<#${match.voice[teamNo]}>`
    : `le salon vocal de ton équipe (**Équipe ${teamNo}**)`;

  return new EmbedBuilder()
    .setColor(config.colors.warn)
    .setAuthor({ name: "⚠️  Avertissement — absence" })
    .setDescription([
      `<@${targetId}> Tu as **${seconds} secondes** pour rejoindre ${voiceMention}.`,
      "Passé ce délai, ta place sera donnée à quelqu'un d'autre.",
      "",
      `⏳ Fin du délai <t:${Math.floor(deadline / 1000)}:R>`,
    ].join("\n"))
    .setFooter({ text: `Partie #${match.id} · Équipe ${teamNo}` })
    .setTimestamp();
}

/** Sélecteur des joueurs de la partie (bouton « Avertir un joueur »). */
function buildWarnSelect(match) {
  const options = [];
  for (const teamNo of [1, 2]) {
    for (const userId of match.teams[teamNo]) {
      const profile = store.getProfile(userId);
      const rankLabel = profile?.rank ? ` · ${formatRank(profile.rank)}` : "";
      options.push({
        label: (profile?.riotId || `Joueur ${userId}`).slice(0, 100),
        description: `Équipe ${teamNo}${rankLabel}`.slice(0, 100),
        value: userId,
        emoji: teamNo === 1 ? config.emojis.team1 : config.emojis.team2,
      });
    }
  }
  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId("warn-select", match.id))
      .setPlaceholder("Quel joueur veux-tu avertir ?")
      .addOptions(options.slice(0, 25)),
  );
}

// ---- Proposition de place au premier de la liste d'attente ----

function buildOfferEmbed(match, teamNo, candidateId, deadline) {
  const emoji = teamNo === 1 ? config.emojis.team1 : config.emojis.team2;
  return new EmbedBuilder()
    .setColor(config.colors.success)
    .setAuthor({ name: "🎟️  Une place s'est libérée" })
    .setDescription([
      `<@${candidateId}> tu es **premier de la liste d'attente** : une place est libre en **Équipe ${teamNo}** ${emoji}.`,
      "",
      `⏳ Réponds <t:${Math.floor(deadline / 1000)}:R>, sinon la place passe au suivant.`,
    ].join("\n"))
    .setFooter({ text: `Partie #${match.id}` });
}

function buildOfferComponents(match, teamNo, candidateId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customId("offer-accept", match.id, `${teamNo}:${candidateId}`))
        .setLabel("Prendre la place")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(customId("offer-decline", match.id, `${teamNo}:${candidateId}`))
        .setLabel("Passer mon tour")
        .setEmoji("⏭️")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ---- Modale de profil Valorant ----

/**
 * Ouverte automatiquement quand un joueur sans profil clique sur « Rejoindre ».
 * `pendingAction` (ex. "join:1") permet de rejouer l'action après validation.
 */
function buildProfileModal(matchId, pendingAction) {
  const modal = new ModalBuilder()
    .setCustomId(customId("profile-modal", matchId, pendingAction))
    .setTitle("Ton profil Valorant");

  const riotId = new TextInputBuilder()
    .setCustomId("riotId")
    .setLabel("Riot ID (Pseudo#TAG)")
    .setPlaceholder("TenZ#0505")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(40)
    .setRequired(true);

  const rank = new TextInputBuilder()
    .setCustomId("rank")
    .setLabel("Ton rang actuel")
    .setPlaceholder("Diamant 2, Immortel, Non classé...")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(30)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(riotId),
    new ActionRowBuilder().addComponents(rank),
  );
  return modal;
}

module.exports = {
  ID, customId, parseCustomId, STATUS,
  errorEmbed, successEmbed, infoEmbed,
  buildMatchEmbed, buildMatchComponents,
  buildWarningEmbed, buildWarnSelect,
  buildOfferEmbed, buildOfferComponents,
  buildProfileModal,
};
