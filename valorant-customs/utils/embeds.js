/**
 * Embeds courts et composants partagés : réponses aux commandes, avertissement
 * anti-absent, proposition de place, modale de profil.
 *
 * Le panneau de partie, lui, est en Components V2 → voir utils/display.js.
 * Aucun effet de bord ici : ce module construit des objets, rien d'autre.
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");

const config = require("../config");
const settings = require("./settings");
const { formatRank } = require("./ranks");
const store = require("./store");

// Préfixe commun aux customId liés à une partie : "vc" = Valorant Custom.
// Format : vc:<action>:<matchId>[:<extra>]
const ID = "vc";
const customId = (action, matchId, extra) =>
  [ID, action, matchId, extra].filter((part) => part !== undefined && part !== null).join(":");

const parseCustomId = (raw) => {
  const [prefix, action, matchId, ...extra] = String(raw).split(":");
  return prefix === ID ? { action, matchId, extra } : null;
};

// ---- Embeds génériques ----

const simpleEmbed = (color, description) => new EmbedBuilder().setColor(color).setDescription(description);
const errorEmbed = (message) => simpleEmbed(config.colors.error, `❌ ${message}`);
const successEmbed = (message) => simpleEmbed(config.colors.success, `✅ ${message}`);
const infoEmbed = (message) => simpleEmbed(config.colors.base, message);

// ---- Système d'avertissement ----

/** Message public d'avertissement : c'est LE message qui ping le joueur. */
function buildWarningEmbed(match, targetId, teamNo, deadline) {
  const seconds = settings.warnSeconds();
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

// ---- Place libre : « Prendre sa place » ----

/**
 * Message public d'une place libérée. Quand un joueur vient d'être retiré pour
 * absence, c'est CE message qui l'annonce — un seul message, un seul bouton.
 */
function buildFreeSpotEmbed(match, teamNo, absentId, reservedUntil) {
  const emoji = teamNo === 1 ? config.emojis.team1 : config.emojis.team2;

  const lines = absentId
    ? [
      `⛔ <@${absentId}> **n'est pas là** — il a été retiré de l'**Équipe ${teamNo}** ${emoji}.`,
      "",
      "**Sa place est libre : clique sur le bouton pour la prendre.**",
    ]
    : [
      `🎟️ Une place s'est libérée en **Équipe ${teamNo}** ${emoji}.`,
      "",
      "**Clique sur le bouton pour la prendre.**",
    ];

  if (reservedUntil) {
    lines.push("", `⏳ Réservée à la liste d'attente jusqu'à <t:${Math.floor(reservedUntil / 1000)}:T>, puis ouverte à tous.`);
  }

  return new EmbedBuilder()
    .setColor(absentId ? config.colors.warn : config.colors.success)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Partie #${match.id}` });
}

function buildClaimComponents(match, teamNo) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customId("claim", match.id, String(teamNo)))
        .setLabel(`Prendre sa place (Équipe ${teamNo})`)
        .setEmoji("🎟️")
        .setStyle(ButtonStyle.Success),
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
  ID, customId, parseCustomId,
  errorEmbed, successEmbed, infoEmbed,
  buildWarningEmbed, buildWarnSelect,
  buildFreeSpotEmbed, buildClaimComponents,
  buildProfileModal,
};
