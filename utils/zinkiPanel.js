const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { registerHandler } = require("./modInteractionRegistry");
const { BADGE_TIERS, BOOST_TIERS, computeTierState, progressBar, formatDateTime } = require("./badgeProgress");

const VIEWS = [
  { key: "badge", label: "Badge" },
  { key: "boost", label: "Boost" },
  { key: "profil", label: "Profil" },
];

// Une couleur d'accent par carte pour bien les distinguer visuellement.
const ACCENT_COLORS = {
  badge: 0xe67e22, // orange/bronze, façon Nitro
  boost: 0xf47fff, // rose boost officiel Discord
  profil: 0x5865f2, // blurple Discord
};

function navRow(currentView, targetId, invokerId) {
  return new ActionRowBuilder().addComponents(
    VIEWS.map((v) =>
      new ButtonBuilder()
        .setCustomId(`zinkiprofile:${v.key}:${targetId}:${invokerId}`)
        .setLabel(v.label)
        .setStyle(v.key === currentView ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(v.key === currentView)
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

// Date de départ du suivi "Badge" (façon Nitro) : arrivée sur CE serveur
// (donnée réelle Discord, `member.joinedAt`) plutôt que la création du
// compte — un compte flambant neuf qui rejoint peu après sa création est ce
// qui explique l'écart de ~2h entre "Début du Nitro" et "Date de création"
// observé sur la référence. Repli sur la création du compte si `joinedAt`
// est indisponible (cas rare de l'API Discord).
function badgeStartDate(member) {
  return member.joinedAt || member.user.createdAt;
}

function renderBoost(member, invokerId) {
  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.boost);
  text(container, `# Progression Boost de ${member.displayName}`);

  if (!member.premiumSince) {
    text(container, "> Ce membre ne boost pas actuellement ce serveur.");
    container.addActionRowComponents(navRow("boost", member.id, invokerId));
    return payload(container);
  }

  const state = computeTierState(member.premiumSince, BOOST_TIERS);
  text(container, `> **Début du boost** : <t:${unix(member.premiumSince)}:F>\n> **Current** : ${state.currentTier.months} mois`);

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

function renderBadge(member, invokerId) {
  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.badge);
  text(container, `# Progression Nitro de ${member.displayName}`);

  const start = badgeStartDate(member);
  const state = computeTierState(start, BADGE_TIERS);
  text(container, `> **Début du Nitro** : <t:${unix(start)}:F>\n> **Current** : ${state.currentTier.months} mois`);

  section(container, "Current Badge :", [`${state.currentTier.emoji} **${state.currentTier.label}** : <t:${unix(state.currentTierDate)}:R>`]);

  if (state.maxed) {
    section(container, "PROGRESSION", ["Palier maximum atteint 🎉"]);
  } else {
    section(container, "PROCHAIN BADGE", [`${state.nextTier.emoji} **${state.nextTier.label}** : <t:${unix(state.nextTierDate)}:R>`]);
    section(container, "PROGRESSION", [`${progressBar(state.percent)} \`${state.percent}%\``]);
  }

  section(
    container,
    "PROCHAINS BADGES",
    state.tierDates.map(({ tier, date }) => `${tier.emoji} **${tier.label}** : <t:${unix(date)}:d> (<t:${unix(date)}:R>)`)
  );

  container.addActionRowComponents(navRow("badge", member.id, invokerId));
  return payload(container);
}

function renderProfil(member, client, invokerId) {
  const badgeState = computeTierState(badgeStartDate(member), BADGE_TIERS);
  const boostState = member.premiumSince ? computeTierState(member.premiumSince, BOOST_TIERS) : null;

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.profil);
  text(container, `# Profile de ${member.displayName}`);
  text(
    container,
    `> **User :** <@${member.id}>\n> **ID :** \`${member.id}\`\n> **Date de creation :** \`${formatDateTime(member.user.createdAt)}\``
  );

  const badgeEmojis = [badgeState.currentTier.emoji, boostState?.currentTier.emoji].filter(Boolean).join(" ");
  section(container, "Badges", [badgeEmojis]);

  const nitroLines = [`${badgeState.currentTier.emoji} **Nitro** (${badgeState.currentTier.months} mois)`];
  if (badgeState.maxed) nitroLines.push("Palier maximum atteint 🎉");
  else {
    nitroLines.push(`Next : ${badgeState.nextTier.emoji} <t:${unix(badgeState.nextTierDate)}:R>`);
    nitroLines.push(`${progressBar(badgeState.percent)} \`${badgeState.percent}%\``);
  }
  section(container, "Nitro", nitroLines);

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

  const pfpUrl = member.displayAvatarURL({ size: 1024, extension: "png" });
  section(container, "`🦋` Utils", [`Pfp : **[Download](${pfpUrl})**`]);

  const mutualGuilds = [...client.guilds.cache.values()].filter((g) => g.members.cache.has(member.id));
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

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Membre introuvable.", ephemeral: true });
    return;
  }

  if (view === "badge") return interaction.update(renderBadge(member, invokerId));
  if (view === "boost") return interaction.update(renderBoost(member, invokerId));
  if (view === "profil") return interaction.update(renderProfil(member, interaction.client, invokerId));
}

registerHandler("zinkiprofile", handle);

module.exports = { renderBadge, renderBoost, renderProfil };
