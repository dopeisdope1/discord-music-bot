const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildCard, appendText, payload } = require("./panelComponents");
const { registerHandler } = require("./modInteractionRegistry");
const { BADGE_TIERS, BOOST_TIERS, computeTierState, progressBar } = require("./badgeProgress");

const VIEWS = [
  { key: "badge", label: "Badge" },
  { key: "boost", label: "Boost" },
  { key: "profil", label: "Profil" },
];

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
  return Math.floor(date.getTime() / 1000);
}

// Carte "Badge"/"Boost" — même structure pour les deux, seule la source de
// la date de départ et les paliers changent.
function renderTierCard({ title, member, invokerId, viewKey, startDate, tiers, emptyDescription }) {
  const container = buildCard({
    title,
    thumbnail: member.displayAvatarURL({ size: 256 }),
    description: startDate ? undefined : emptyDescription,
    fields: startDate
      ? [
          { name: "Début", value: `<t:${unix(startDate)}:F>` },
          { name: "Actuel", value: `${computeTierState(startDate, tiers).currentTier.months} mois` },
        ]
      : [],
  });

  if (startDate) {
    const state = computeTierState(startDate, tiers);

    appendText(
      container,
      `**Badge actuel**\n${state.currentTier.emoji} **${state.currentTier.label}** : <t:${unix(state.currentTierDate)}:R>`
    );

    if (!state.maxed) {
      appendText(
        container,
        `**Prochain badge**\n${state.nextTier.emoji} **${state.nextTier.label}** : <t:${unix(state.nextTierDate)}:R>`
      );
      appendText(container, `**Progression**\n${progressBar(state.percent)} \`${state.percent}%\``);
    } else {
      appendText(container, "**Progression**\nPalier maximum atteint 🎉");
    }

    const lines = state.tierDates.map(
      ({ tier, date }) => `${tier.emoji} **${tier.label}** : <t:${unix(date)}:D> (<t:${unix(date)}:R>)`
    );
    appendText(container, `**Tous les paliers**\n${lines.join("\n")}`);
  }

  container.addActionRowComponents(navRow(viewKey, member.id, invokerId));
  return payload(container);
}

function renderBadge(member, invokerId) {
  return renderTierCard({
    title: `Progression Badge de ${member.displayName}`,
    member,
    invokerId,
    viewKey: "badge",
    startDate: member.user.createdAt,
    tiers: BADGE_TIERS,
  });
}

function renderBoost(member, invokerId) {
  return renderTierCard({
    title: `Progression Boost de ${member.displayName}`,
    member,
    invokerId,
    viewKey: "boost",
    startDate: member.premiumSince,
    tiers: BOOST_TIERS,
    emptyDescription: "Ce membre ne boost pas actuellement ce serveur.",
  });
}

function renderProfil(member, client, invokerId) {
  const badgeState = computeTierState(member.user.createdAt, BADGE_TIERS);
  const boostState = member.premiumSince ? computeTierState(member.premiumSince, BOOST_TIERS) : null;

  const badgesLine = [badgeState.currentTier.emoji, boostState?.currentTier.emoji].filter(Boolean).join(" ") || "aucun";

  const container = buildCard({
    title: `Profil de ${member.displayName}`,
    thumbnail: member.displayAvatarURL({ size: 256 }),
    image: member.displayAvatarURL({ size: 1024 }),
    fields: [
      { name: "User", value: `<@${member.id}>` },
      { name: "ID", value: member.id },
      { name: "Date de création", value: `<t:${unix(member.user.createdAt)}:F>` },
      { name: "Badges", value: badgesLine },
    ],
  });

  const badgeNext = badgeState.maxed
    ? "Palier maximum atteint 🎉"
    : `Next : ${badgeState.nextTier.emoji} <t:${unix(badgeState.nextTierDate)}:R> — ${badgeState.percent}%`;
  appendText(
    container,
    `**Badge**\n${badgeState.currentTier.emoji} ${badgeState.currentTier.label} (${badgeState.currentTier.months} mois)\n${badgeNext}`
  );

  if (boostState) {
    const boostNext = boostState.maxed
      ? "Palier maximum atteint 🎉"
      : `Next : ${boostState.nextTier.emoji} <t:${unix(boostState.nextTierDate)}:R> — ${boostState.percent}%`;
    appendText(container, `**Boost**\n${boostState.currentTier.emoji} ${boostState.currentTier.label}\n${boostNext}`);
  } else {
    appendText(container, "**Boost**\nAucun boost actif sur ce serveur.");
  }

  const mutualGuilds = [...client.guilds.cache.values()].filter((g) => g.members.cache.has(member.id));
  appendText(
    container,
    `**Serveur en commun**\n${mutualGuilds.length ? mutualGuilds.map((g) => `• ${g.name}`).join("\n") : "Aucun autre serveur en commun connu."}`
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Télécharger le pfp")
        .setStyle(ButtonStyle.Link)
        .setURL(member.displayAvatarURL({ size: 1024, extension: "png" }))
    )
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
