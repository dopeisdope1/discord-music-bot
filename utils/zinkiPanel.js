const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { registerHandler } = require("./modInteractionRegistry");
const { BOOST_TIERS, computeTierState, progressBar, formatDateTime } = require("./boostProgress");

const VIEWS = [
  { key: "boost", label: "Boost" },
  { key: "profil", label: "Profil" },
];

// Une couleur d'accent par carte pour bien les distinguer visuellement.
const ACCENT_COLORS = {
  boost: 0xf47fff, // rose boost officiel Discord
  profil: 0x5865f2, // blurple Discord
};

// La vue active reste CLIQUABLE (contrairement à la barre du &panel) : les
// pourcentages/barres de progression sont calculés au moment du rendu et
// figés dans le message, donc recliquer la vue courante sert de bouton
// "actualiser". Les dates en <t:...:R> ("dans 12 jours"), elles, sont déjà
// live côté client Discord et n'ont jamais besoin d'être rafraîchies.
function navRow(currentView, targetId, invokerId) {
  return new ActionRowBuilder().addComponents(
    VIEWS.map((v) =>
      new ButtonBuilder()
        .setCustomId(`zinkiprofile:${v.key}:${targetId}:${invokerId}`)
        .setLabel(v.key === currentView ? `${v.label} ⟳` : v.label)
        .setStyle(v.key === currentView ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
}

function unix(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function text(container, content) {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

// "## heading" suivi d'un bloc de citation ">" (une ligne par entrée) — même
// forme que la référence pour chaque sous-section (Current Badge, Progression...).
// Séparateur fin avant chaque section, comme sur la référence.
function section(container, heading, lines) {
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  text(container, `## ${heading}`);
  text(container, lines.map((l) => `> ${l}`).join("\n"));
}

function payload(container) {
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// En-tête des 3 cartes : titre + bloc d'infos à gauche, avatar en vignette à
// droite (Section + accessoire Thumbnail) — comme sur la référence.
function header(container, member, title, infoLines) {
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${title}`),
        new TextDisplayBuilder().setContent(infoLines.map((l) => `> ${l}`).join("\n"))
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(member.displayAvatarURL({ size: 256 })))
  );
}

function renderBoost(member, invokerId) {
  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.boost);

  if (!member.premiumSince) {
    header(container, member, `Progression Boost de ${member.displayName}`, ["Ce membre ne boost pas actuellement ce serveur."]);
    container.addActionRowComponents(navRow("boost", member.id, invokerId));
    return payload(container);
  }

  const state = computeTierState(member.premiumSince, BOOST_TIERS);
  header(container, member, `Progression Boost de ${member.displayName}`, [
    `**Début du boost** : <t:${unix(member.premiumSince)}:F>`,
    `**Current** : ${state.currentTier.months} mois`,
  ]);

  section(container, "Current Badge :", [`${state.currentTier.emoji} **${state.currentTier.label}** : <t:${unix(state.currentTierDate)}:R>`]);

  if (state.maxed) {
    section(container, "PROGRESSION", ["Palier maximum atteint 🎉"]);
  } else {
    section(container, "PROCHAINE EVOLUTION", [`${state.nextTier.emoji} **${state.nextTier.label}** : <t:${unix(state.nextTierDate)}:R>`]);
    section(container, "PROGRESSION", [`${progressBar(state.percent)} \`${state.percent}%\``]);
  }

  section(
    container,
    "HISTORIQUE",
    state.tierDates.map(({ tier, date }) => `${tier.emoji} **${tier.label}** : <t:${unix(date)}:d> (<t:${unix(date)}:R>)`)
  );

  container.addActionRowComponents(navRow("boost", member.id, invokerId));
  return payload(container);
}

// Serveurs en commun : `guild.members.cache` n'est pas fiable (le cache d'un
// serveur peut être partiel/vieilli selon ce que la gateway a poussé), donc
// on interroge réellement chaque serveur. `fetch` sur un membre absent lève
// une erreur — c'est justement le signal "pas en commun".
async function fetchMutualGuilds(member, client) {
  const guilds = [...client.guilds.cache.values()];
  const results = await Promise.all(
    guilds.map(async (guild) => {
      if (guild.members.cache.has(member.id)) return guild;
      const found = await guild.members.fetch(member.id).catch(() => null);
      return found ? guild : null;
    })
  );
  return results.filter(Boolean);
}

async function renderProfil(member, client, invokerId) {
  // Boost : `premiumSince`, refetché avec le membre à chaque rendu, jamais stocké.
  const boostState = member.premiumSince ? computeTierState(member.premiumSince, BOOST_TIERS) : null;

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.profil);
  header(container, member, `Profile de ${member.displayName}`, [
    `**User :** <@${member.id}>`,
    `**ID :** \`${member.id}\``,
    `**Date de creation :** \`${formatDateTime(member.user.createdAt)}\``,
  ]);

  section(container, "Badges", [boostState ? boostState.currentTier.emoji : "aucun"]);

  if (boostState) {
    const boostLines = [`${boostState.currentTier.emoji} **Boost** (${boostState.currentTier.months} mois)`];
    if (boostState.maxed) boostLines.push("Palier maximum atteint 🎉");
    else {
      boostLines.push(`Next : ${boostState.nextTier.emoji} <t:${unix(boostState.nextTierDate)}:R>`);
      boostLines.push(`${progressBar(boostState.percent)} \`${boostState.percent}%\``);
    }
    section(container, "Boost", boostLines);
  } else {
    section(container, "Boost", ["Aucun boost actif sur ce serveur."]);
  }

  // Grand aperçu de l'avatar entre les stats et "Utils", comme sur la référence.
  const pfpUrl = member.displayAvatarURL({ size: 1024, extension: "png" });
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(pfpUrl)));

  section(container, "`🦋` Utils", [`Pfp : **[Download](${pfpUrl})**`]);

  const mutualGuilds = await fetchMutualGuilds(member, client);
  section(
    container,
    "`🍂` Serveur en commun",
    mutualGuilds.length ? mutualGuilds.map((g) => `- ***${g.name}***`) : ["Aucun autre serveur en commun connu."]
  );

  container.addActionRowComponents(navRow("profil", member.id, invokerId));
  return payload(container);
}

async function handle(interaction) {
  const [, view, targetId, invokerId] = interaction.customId.split(":");

  if (interaction.user.id !== invokerId) {
    await interaction.reply({ content: "Seul l'auteur de la commande peut naviguer ici.", ephemeral: true });
    return;
  }

  // `force: true` : on veut l'état réel au moment du clic (boost qui vient
  // d'être activé/expiré...), pas ce que la gateway avait poussé au départ —
  // c'est tout l'intérêt de recliquer pour actualiser.
  const member = await interaction.guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Membre introuvable.", ephemeral: true });
    return;
  }

  if (view === "boost") return interaction.update(renderBoost(member, invokerId));
  if (view === "profil") {
    // renderProfil interroge les serveurs en commun (I/O) : on accuse
    // réception d'abord pour ne pas dépasser les 3s imposées par Discord.
    await interaction.deferUpdate();
    return interaction.editReply(await renderProfil(member, interaction.client, invokerId));
  }
}

registerHandler("zinkiprofile", handle);

module.exports = { renderBoost, renderProfil };
