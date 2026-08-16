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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { registerHandler } = require("./modInteractionRegistry");
const { BADGE_TIERS, BOOST_TIERS, computeTierState, progressBar, formatDateTime } = require("./badgeProgress");
const nitroStore = require("./nitroStore");

const VIEWS = [
  { key: "nitro", label: "Nitro" },
  { key: "boost", label: "Boost" },
  { key: "profil", label: "Profil" },
];

// Une couleur d'accent par carte pour bien les distinguer visuellement.
const ACCENT_COLORS = {
  nitro: 0xe67e22, // orange/bronze, façon Nitro
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

// Qui a le droit de renseigner/réinitialiser la date Nitro d'un profil :
// la personne elle-même, ou un admin du serveur qui consulte quelqu'un d'autre.
function canEditNitro(interactionUserId, targetId, member) {
  if (interactionUserId === targetId) return true;
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function nitroModal(targetId) {
  return new ModalBuilder()
    .setCustomId(`zinkinitro:submit:${targetId}`)
    .setTitle("Date d'abonnement Nitro")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("date")
          .setLabel("Date (JJ/MM/AAAA)")
          .setPlaceholder("15/04/2026")
          .setStyle(TextInputStyle.Short)
          .setMinLength(8)
          .setMaxLength(10)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("time")
          .setLabel("Heure (HH:mm) — optionnel")
          .setPlaceholder("13:24")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(5)
          .setRequired(false)
      )
    );
}

// Deux sources possibles, dans cet ordre :
//   1. la vraie date d'abonnement, si elle a été saisie (nitroStore) ;
//   2. à défaut, la création du compte — automatique pour tout le monde, mais
//      ce n'est PAS du Nitro, donc c'est affiché comme tel.
//
// L'API bot de Discord n'expose rien sur le Nitro (ni statut, ni date) : la
// seule source exacte reste la saisie manuelle. Le repli n'est là que pour
// que la carte ne soit jamais vide, et il est explicitement étiqueté
// "estimation" — une date fausse présentée comme vraie serait pire que rien.
function renderNitro(member, invokerId, viewerMember) {
  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.nitro);
  const realStart = nitroStore.getNitroSince(member.id);
  const start = realStart || member.user.createdAt;
  const state = computeTierState(start, BADGE_TIERS);
  const editable = canEditNitro(invokerId, member.id, viewerMember);

  header(
    container,
    member,
    `Progression Nitro de ${member.displayName}`,
    realStart
      ? [`**Début du Nitro** : <t:${unix(start)}:F>`, `**Current** : ${state.currentTier.months} mois`]
      : [
          `**Création du compte** : <t:${unix(start)}:F>`,
          `**Current** : ${state.currentTier.months} mois`,
          "-# Estimation basée sur l'âge du compte — l'API Discord ne donne pas la date d'abonnement Nitro aux bots.",
        ]
  );

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

  if (editable) {
    container.addActionRowComponents(
      realStart
        ? new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`zinkinitro:open:${member.id}`).setLabel("Modifier la date").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`zinkinitro:reset:${member.id}`).setLabel("Réinitialiser").setStyle(ButtonStyle.Danger)
          )
        : new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`zinkinitro:open:${member.id}`)
              .setLabel("Renseigner ma vraie date Nitro")
              .setStyle(ButtonStyle.Success)
          )
    );
  }

  container.addActionRowComponents(navRow("nitro", member.id, invokerId));
  return payload(container);
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
  // Nitro : vraie date saisie si disponible, sinon repli sur l'âge du compte
  // (voir renderNitro). Boost : `premiumSince`, refetché avec le membre à
  // chaque rendu, jamais stocké.
  const realNitro = nitroStore.getNitroSince(member.id);
  const badgeState = computeTierState(realNitro || member.user.createdAt, BADGE_TIERS);
  const boostState = member.premiumSince ? computeTierState(member.premiumSince, BOOST_TIERS) : null;

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLORS.profil);
  header(container, member, `Profile de ${member.displayName}`, [
    `**User :** <@${member.id}>`,
    `**ID :** \`${member.id}\``,
    `**Date de creation :** \`${formatDateTime(member.user.createdAt)}\``,
  ]);

  // Collection : TOUS les paliers déjà débloqués, pas seulement le palier
  // courant (qui est de toute façon détaillé dans la section "Nitro" juste
  // en dessous). `tierDates` est trié par ancienneté croissante, donc les
  // paliers atteints sont ceux dont la date est déjà passée.
  const now = Date.now();
  const unlocked = badgeState.tierDates.filter(({ date }) => date.getTime() <= now).map(({ tier }) => tier.emoji);
  if (boostState) unlocked.push(boostState.currentTier.emoji);
  section(container, "Badges", [unlocked.join(" ")]);

  const nitroLines = [`${badgeState.currentTier.emoji} **Nitro** (${badgeState.currentTier.months} mois)`];
  if (badgeState.maxed) nitroLines.push("Palier maximum atteint 🎉");
  else {
    nitroLines.push(`Next : ${badgeState.nextTier.emoji} <t:${unix(badgeState.nextTierDate)}:R>`);
    nitroLines.push(`${progressBar(badgeState.percent)} \`${badgeState.percent}%\``);
  }
  if (!realNitro) nitroLines.push("-# Estimation sur l'âge du compte — voir l'onglet **Nitro** pour saisir la vraie date.");
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

  if (view === "nitro") return interaction.update(renderNitro(member, invokerId, interaction.member));
  if (view === "boost") return interaction.update(renderBoost(member, invokerId));
  if (view === "profil") {
    // renderProfil interroge les serveurs en commun (I/O) : on accuse
    // réception d'abord pour ne pas dépasser les 3s imposées par Discord.
    await interaction.deferUpdate();
    return interaction.editReply(await renderProfil(member, interaction.client, invokerId));
  }
}

// Saisie/réinitialisation de la vraie date Nitro (boutons + modal de la vue Nitro).
async function handleNitro(interaction) {
  const [, action, targetId] = interaction.customId.split(":");

  if (!canEditNitro(interaction.user.id, targetId, interaction.member)) {
    await interaction.reply({
      content: "Seule la personne concernée (ou un admin du serveur) peut modifier cette date.",
      ephemeral: true,
    });
    return;
  }

  if (action === "open") {
    return interaction.showModal(nitroModal(targetId));
  }

  const member = await interaction.guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Membre introuvable.", ephemeral: true });
    return;
  }

  if (action === "reset") {
    nitroStore.clearNitroSince(targetId);
    // Redessine le panel en place plutôt que d'envoyer un nouveau message.
    return interaction.update(renderNitro(member, interaction.user.id, interaction.member));
  }

  if (action === "submit") {
    const { date, error } = nitroStore.parseAndValidate(
      interaction.fields.getTextInputValue("date"),
      interaction.fields.getTextInputValue("time"),
      member.user.createdAt
    );

    if (error) {
      await interaction.reply({ content: `❌ ${error}`, ephemeral: true });
      return;
    }

    nitroStore.setNitroSince(targetId, date, interaction.user.id);
    return interaction.update(renderNitro(member, interaction.user.id, interaction.member));
  }
}

registerHandler("zinkiprofile", handle);
registerHandler("zinkinitro", handleNitro);

module.exports = { renderNitro, renderBoost, renderProfil };
