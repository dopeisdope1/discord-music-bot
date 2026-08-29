/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PANNEAU DE CONTRÔLE — réservé au root et aux propriétaires du bot
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Entièrement éphémère : personne d'autre ne voit le panneau, même dans un
 * salon public. La navigation se fait par `interaction.update()`, donc un seul
 * message pour tout le panneau.
 *
 * Sections :
 *   👑 Propriétaires   — donner / retirer l'ownership          (ROOT UNIQUEMENT)
 *   🔑 Gestionnaires   — accès à la gestion de toutes les parties
 *   🎮 Parties         — kick, swap, mélange, rapatriement, salons, fin
 *   ⚙️ Réglages        — délais, auto-attribution, logs, catégorie vocale
 *
 * Chaque interaction re-vérifie les droits : un customId ne suffit jamais à
 * autoriser une action.
 */

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, MessageFlags,
} = require("discord.js");

const config = require("../config");
const access = require("./access");
const settings = require("./settings");
const store = require("./store");
const { logEvent } = require("./logger");
const { formatRank } = require("./ranks");
const {
  findTeam, removePlayer, addToTeam, refreshMatchMessage, announce,
} = require("./matches");
const { errorEmbed, successEmbed } = require("./embeds");
const {
  createTeamChannels, deleteTeamChannels, syncTeamPermissions, moveToTeamChannel,
} = require("./voice");
const warnings = require("./warnings");
const { endMatch } = require("./matchActions");

// Préfixe des customId du panneau : "vp" = Valorant Panel.
const PID = "vp";
const pid = (...parts) => [PID, ...parts.filter((p) => p !== undefined && p !== null)].join(":");
const parsePanelId = (raw) => {
  const [prefix, action, ...args] = String(raw).split(":");
  return prefix === PID ? { action, args } : null;
};

const mentions = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "*aucun*");
const onOff = (value) => (value ? "🟢 activé" : "⚪ désactivé");

/**
 * Libellé lisible pour les options de menu (qui n'affichent pas les mentions).
 * Retombe sur l'ID si l'utilisateur est introuvable (compte supprimé…).
 */
async function userLabel(client, userId) {
  try {
    const user = await client.users.fetch(userId);
    return user.tag || user.username || `ID ${userId}`;
  } catch {
    return `ID ${userId}`;
  }
}

const userLabels = (client, ids) => Promise.all(ids.map(async (id) => ({ id, label: await userLabel(client, id) })));

// ─────────────────────────────── ACCUEIL ───────────────────────────────

function buildHome(userId, guildId) {
  const owners = access.listOwners();
  const managers = access.listManagers();
  const matches = store.allMatches().filter((m) => m.guildId === guildId && m.status !== "ended");
  const activeWarnings = matches.reduce((total, m) => total + Object.keys(m.warnings || {}).length, 0);

  const embed = new EmbedBuilder()
    .setColor(config.colors.base)
    .setTitle("⚙️  Panneau de contrôle")
    .setDescription([
      `Ton rang · **${access.tierLabel(userId)}**`,
      config.separator,
      `👑 **Root** · ${mentions(access.rootIds())}`,
      `🛡️ **Propriétaires** · ${owners.length ? mentions(owners) : "*aucun*"}`,
      `🔧 **Gestionnaires** · ${managers.length ? mentions(managers) : "*aucun*"}`,
      "",
      `🎮 **Parties en cours** · ${matches.length}`,
      `⚠️ **Avertissements actifs** · ${activeWarnings}`,
    ].join("\n"))
    .setFooter({ text: "Panneau visible de toi seul" });

  const options = [
    { label: "Gestionnaires", value: "managers", description: "Donner l'accès à la gestion des parties", emoji: "🔑" },
    { label: "Parties en cours", value: "matches", description: "Kick, swap, mélange, salons vocaux, fin", emoji: "🎮" },
    { label: "Réglages", value: "settings", description: "Délais, auto-attribution, logs, catégorie", emoji: "⚙️" },
  ];
  // La distribution de l'ownership n'apparaît que pour le root.
  if (access.isRoot(userId)) {
    options.unshift({ label: "Propriétaires", value: "owners", description: "Donner ou retirer l'ownership du bot", emoji: "👑" });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(pid("nav")).setPlaceholder("Ouvrir une section…").addOptions(options),
      ),
    ],
  };
}

const backRow = (...extra) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(pid("home")).setLabel("Retour").setEmoji("◀️").setStyle(ButtonStyle.Secondary),
    ...extra,
  );

// ───────────────────────── PROPRIÉTAIRES (root) ─────────────────────────

async function buildOwners(client, userId) {
  const owners = access.listOwners();
  const labels = await userLabels(client, owners);

  const embed = new EmbedBuilder()
    .setColor(config.colors.live)
    .setTitle("👑  Propriétaires du bot")
    .setDescription([
      "Un **propriétaire** a un accès complet au bot : toutes les commandes, la",
      "gestion de toutes les parties, et l'ouverture de ce panneau.",
      "",
      "Il ne peut **pas** donner ou retirer l'ownership : toi seul le peux.",
      config.separator,
      `👑 **Root** · ${mentions(access.rootIds())}`,
      `🛡️ **Propriétaires** · ${owners.length ? mentions(owners) : "*aucun pour l'instant*"}`,
    ].join("\n"));

  const rows = [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(pid("owner-add")).setPlaceholder("➕ Donner l'ownership à…").setMaxValues(1),
    ),
  ];

  if (owners.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(pid("owner-remove"))
        .setPlaceholder("➖ Retirer l'ownership à…")
        .addOptions(labels.slice(0, 25).map(({ id, label }) => ({ label, value: id, emoji: "🛡️" }))),
    ));
  }

  rows.push(backRow());
  return { embeds: [embed], components: rows };
}

// ───────────────────────────── GESTIONNAIRES ─────────────────────────────

async function buildManagers(client) {
  const managers = access.listManagers();
  const labels = await userLabels(client, managers);

  const embed = new EmbedBuilder()
    .setColor(config.colors.base)
    .setTitle("🔑  Gestionnaires")
    .setDescription([
      "Un **gestionnaire** peut gérer *toutes* les parties du serveur :",
      "avertir, déplacer, kick, lancer et terminer — comme s'il en était l'hôte.",
      "Il n'a **pas** accès à ce panneau.",
      config.separator,
      `🔧 **Gestionnaires** · ${managers.length ? mentions(managers) : "*aucun pour l'instant*"}`,
    ].join("\n"));

  const rows = [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(pid("manager-add")).setPlaceholder("➕ Nommer un gestionnaire…").setMaxValues(1),
    ),
  ];

  if (managers.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(pid("manager-remove"))
        .setPlaceholder("➖ Retirer un gestionnaire…")
        .addOptions(labels.slice(0, 25).map(({ id, label }) => ({ label, value: id, emoji: "🔧" }))),
    ));
  }

  rows.push(backRow());
  return { embeds: [embed], components: rows };
}

// ────────────────────────────── PARTIES ──────────────────────────────

function activeMatches(guildId) {
  return store
    .allMatches()
    .filter((match) => match.guildId === guildId && match.status !== "ended")
    .sort((a, b) => b.createdAt - a.createdAt);
}

function buildMatchList(guildId) {
  const matches = activeMatches(guildId);

  const embed = new EmbedBuilder()
    .setColor(config.colors.base)
    .setTitle("🎮  Parties en cours")
    .setDescription(matches.length
      ? matches.map((match) => {
        const total = match.teams[1].length + match.teams[2].length;
        const status = match.status === "live" ? "🔴 en cours" : "🟡 en attente";
        return `\`#${match.id}\` · ${match.format.label} · ${status} · **${total}** joueur(s) · <#${match.channelId}>`;
      }).join("\n")
      : "*Aucune partie en cours sur ce serveur.*");

  const rows = [];
  if (matches.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(pid("match-pick"))
        .setPlaceholder("Gérer une partie…")
        .addOptions(matches.slice(0, 25).map((match) => ({
          label: `#${match.id} · ${match.format.label}`,
          description: `${match.teams[1].length + match.teams[2].length} joueur(s) · ${match.status === "live" ? "en cours" : "en attente"}`,
          value: match.id,
          emoji: match.status === "live" ? "🔴" : "🟡",
        }))),
    ));
  }
  rows.push(backRow());
  return { embeds: [embed], components: rows };
}

function matchRoster(match) {
  const line = (userId) => {
    const profile = store.getProfile(userId);
    return `<@${userId}>${profile ? ` · \`${profile.riotId}\` · ${formatRank(profile.rank)}` : ""}`;
  };
  return [
    `${config.emojis.team1} **Équipe 1** (${match.teams[1].length}/${match.format.perTeam})`,
    match.teams[1].length ? match.teams[1].map(line).join("\n") : "*vide*",
    "",
    `${config.emojis.team2} **Équipe 2** (${match.teams[2].length}/${match.format.perTeam})`,
    match.teams[2].length ? match.teams[2].map(line).join("\n") : "*vide*",
    "",
    `${config.emojis.waitlist} **Liste d'attente** (${match.waitlist.length})`,
    match.waitlist.length ? match.waitlist.map(line).join("\n") : "*vide*",
  ].join("\n");
}

function buildMatchView(match, notice = null) {
  const embed = new EmbedBuilder()
    .setColor(match.status === "live" ? config.colors.live : config.colors.waiting)
    .setTitle(`🎮  Partie #${match.id} — ${match.format.label}`)
    .setDescription([
      `Hôte · <@${match.hostId}>${match.map ? `   ${config.emojis.map} \`${match.map}\`` : ""}`,
      `Statut · ${match.status === "live" ? "🔴 en cours" : "🟡 en attente"}   Salon · <#${match.channelId}>`,
      config.separator,
      matchRoster(match),
    ].join("\n"));

  if (notice) embed.addFields({ name: config.separator, value: notice });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(pid("m-kick", match.id)).setLabel("Kick").setEmoji("⛔").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(pid("m-swap", match.id)).setLabel("Échanger 2 joueurs").setEmoji("🔁").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(pid("m-shuffle", match.id)).setLabel("Mélanger").setEmoji("🎲").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(pid("m-gather", match.id)).setLabel("Rapatrier en vocal").setEmoji("🔊").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(pid("m-voice", match.id)).setLabel("Recréer les salons").setEmoji("🛠️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(pid("m-end", match.id)).setLabel("Terminer").setEmoji("🛑").setStyle(ButtonStyle.Danger),
      ),
      backRow(
        new ButtonBuilder().setCustomId(pid("matches")).setLabel("Autres parties").setEmoji("🎮").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// ────────────────────────────── RÉGLAGES ──────────────────────────────

function buildSettings() {
  const logChannelId = settings.get("logChannelId");
  const categoryId = settings.get("voiceCategoryId");

  const embed = new EmbedBuilder()
    .setColor(config.colors.base)
    .setTitle("⚙️  Réglages")
    .setDescription([
      `⌨️ **Préfixe des commandes** · \`${settings.get("prefix")}\``,
      `⏱️ **Délai d'avertissement** · ${settings.warnSeconds()} s`,
      `🎟️ **Délai de réponse (place proposée)** · ${settings.promoteSeconds()} s`,
      `⚡ **Attribution automatique** · ${onOff(settings.get("autoPromote"))} *(sans confirmation)*`,
      `🔊 **N'importe quel vocal vaut présence** · ${onOff(settings.get("warnAcceptAnyVoice"))} *(avant lancement)*`,
      `🔒 **Création réservée** · ${onOff(settings.get("restrictCreation"))} *(/custom limité aux autorisés)*`,
      config.separator,
      `📝 **Salon de logs** · ${logChannelId ? `<#${logChannelId}>` : "*aucun*"}`,
      `📁 **Catégorie des vocaux** · ${categoryId ? `<#${categoryId}>` : "*celle du salon de la partie*"}`,
    ].join("\n"));

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(pid("set-prefix")).setLabel("Changer le préfixe").setEmoji("⌨️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(pid("set-delays")).setLabel("Modifier les délais").setEmoji("⏱️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(pid("toggle", "autoPromote")).setLabel("Attribution auto").setEmoji("⚡").setStyle(settings.get("autoPromote") ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(pid("toggle", "warnAcceptAnyVoice")).setLabel("Tout vocal").setEmoji("🔊").setStyle(settings.get("warnAcceptAnyVoice") ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(pid("toggle", "restrictCreation")).setLabel("Création réservée").setEmoji("🔒").setStyle(settings.get("restrictCreation") ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(pid("set-log"))
          .setPlaceholder("📝 Salon de logs (laisser vide = aucun)")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(pid("set-category"))
          .setPlaceholder("📁 Catégorie des salons vocaux")
          .addChannelTypes(ChannelType.GuildCategory)
          .setMinValues(0)
          .setMaxValues(1),
      ),
      backRow(),
    ],
  };
}

function buildPrefixModal() {
  return new ModalBuilder()
    .setCustomId(pid("prefix-modal"))
    .setTitle("Préfixe des commandes")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("prefix")
          .setLabel("Nouveau préfixe (1 à 5 caractères)")
          .setPlaceholder("+")
          .setValue(settings.get("prefix"))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(5)
          .setRequired(true),
      ),
    );
}

function buildDelaysModal() {
  return new ModalBuilder()
    .setCustomId(pid("delays-modal"))
    .setTitle("Délais du bot")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("warn")
          .setLabel("Avertissement (secondes)")
          .setPlaceholder("60")
          .setValue(String(settings.warnSeconds()))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("promote")
          .setLabel("Réponse à une place proposée (secondes)")
          .setPlaceholder("60")
          .setValue(String(settings.promoteSeconds()))
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(true),
      ),
    );
}

// ─────────────────────── ACTIONS SUR UNE PARTIE ───────────────────────

/** Emplacement d'un joueur : { list: "1"|"2"|"waitlist", index } ou null. */
function locate(match, userId) {
  for (const teamNo of [1, 2]) {
    const index = match.teams[teamNo].indexOf(userId);
    if (index !== -1) return { list: match.teams[teamNo], index, label: `Équipe ${teamNo}`, teamNo };
  }
  const index = match.waitlist.indexOf(userId);
  return index !== -1 ? { list: match.waitlist, index, label: "liste d'attente", teamNo: null } : null;
}

async function doKick(client, match, targetId, actorId) {
  const teamNo = findTeam(match, targetId);
  await warnings.cancelWarning(client, match, targetId, { silent: true });
  removePlayer(match, targetId);
  store.save();
  await refreshMatchMessage(client, match);

  await announce(client, match, {
    content: `<@${targetId}> a été retiré de la partie par un responsable.`,
    mentionUsers: [targetId],
  });
  logEvent(client, "kick", { matchId: match.id, description: `<@${targetId}> retiré par <@${actorId}> (panneau).` });

  if (teamNo) await warnings.offerSpot(client, match, teamNo);
  return `⛔ <@${targetId}> retiré de la partie.`;
}

async function doSwap(client, match, [a, b], actorId) {
  const first = locate(match, a);
  const second = locate(match, b);
  if (!first || !second) return "❌ Les deux joueurs doivent participer à cette partie.";
  if (first.list === second.list) return "❌ Ces deux joueurs sont déjà au même endroit.";

  first.list[first.index] = b;
  second.list[second.index] = a;
  store.save();
  await refreshMatchMessage(client, match);

  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (guild) {
    for (const teamNo of [1, 2]) await syncTeamPermissions(guild, match, teamNo);
    if (match.status === "live") {
      for (const userId of [a, b]) {
        const teamNo = findTeam(match, userId);
        if (teamNo) await moveToTeamChannel(guild, match, teamNo, userId);
      }
    }
  }

  logEvent(client, "join", { matchId: match.id, description: `<@${a}> ↔ <@${b}> échangés par <@${actorId}> (panneau).` });
  return `🔁 <@${a}> (${first.label}) ↔ <@${b}> (${second.label}).`;
}

async function doShuffle(client, match, actorId) {
  const players = [...match.teams[1], ...match.teams[2]];
  if (players.length < 2) return "❌ Il faut au moins deux joueurs pour mélanger.";

  // Fisher-Yates : mélange uniforme, contrairement à un sort() aléatoire.
  for (let i = players.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  // Répartition équilibrée, plafonnée à la capacité du format. Le surplus part
  // en tête de liste d'attente : un mélange ne doit JAMAIS faire disparaître
  // un joueur de la partie.
  const capacity = match.format.perTeam;
  const firstHalf = Math.min(Math.ceil(players.length / 2), capacity);
  match.teams[1] = players.slice(0, firstHalf);
  match.teams[2] = players.slice(firstHalf, firstHalf + capacity);
  const overflow = players.slice(firstHalf + match.teams[2].length);
  if (overflow.length) match.waitlist = [...overflow, ...match.waitlist];

  store.save();
  await refreshMatchMessage(client, match);

  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (guild) {
    for (const teamNo of [1, 2]) {
      await syncTeamPermissions(guild, match, teamNo);
      if (match.status === "live") {
        for (const userId of match.teams[teamNo]) await moveToTeamChannel(guild, match, teamNo, userId);
      }
    }
  }

  await announce(client, match, { embeds: [successEmbed("🎲 Les équipes ont été mélangées.")] });
  logEvent(client, "join", { matchId: match.id, description: `Équipes mélangées par <@${actorId}> (panneau).` });

  const surplus = overflow.length ? ` **${overflow.length}** joueur(s) en trop placé(s) en liste d'attente.` : "";
  return `🎲 Équipes mélangées et salons vocaux resynchronisés.${surplus}`;
}

async function doGather(client, match) {
  if (!match.voice?.[1] && !match.voice?.[2]) return "❌ Les salons vocaux n'existent pas encore : lance d'abord la partie.";

  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (!guild) return "❌ Serveur introuvable.";

  let moved = 0;
  for (const teamNo of [1, 2]) {
    for (const userId of match.teams[teamNo]) {
      const result = await moveToTeamChannel(guild, match, teamNo, userId);
      if (result.moved) moved += 1;
    }
  }
  return `🔊 **${moved}** joueur(s) déplacé(s) dans le salon de leur équipe.`;
}

async function doRecreateVoice(client, match, channelParentId) {
  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (!guild) return "❌ Serveur introuvable.";

  await deleteTeamChannels(client, match);
  const { error } = await createTeamChannels(guild, match, channelParentId);
  store.save();
  if (error) return `❌ Création impossible : ${error}`;

  await refreshMatchMessage(client, match);
  logEvent(client, "voice", { matchId: match.id, description: "Salons vocaux recréés depuis le panneau." });
  return `🛠️ Salons recréés · <#${match.voice[1]}> et <#${match.voice[2]}>.`;
}

// ─────────────────────────── ROUTAGE DU PANNEAU ───────────────────────────

const denied = (interaction) =>
  interaction.reply({
    embeds: [errorEmbed("Ce panneau est réservé aux propriétaires du bot.")],
    flags: MessageFlags.Ephemeral,
  });

/** Sélecteur de joueur à kick (liste bornée aux participants). */
function buildKickSelect(match) {
  const options = [];
  for (const teamNo of [1, 2]) {
    for (const userId of match.teams[teamNo]) {
      const profile = store.getProfile(userId);
      options.push({
        label: (profile?.riotId || `Joueur ${userId}`).slice(0, 100),
        description: `Équipe ${teamNo}`,
        value: userId,
        emoji: teamNo === 1 ? config.emojis.team1 : config.emojis.team2,
      });
    }
  }
  for (const userId of match.waitlist) {
    const profile = store.getProfile(userId);
    options.push({
      label: (profile?.riotId || `Joueur ${userId}`).slice(0, 100),
      description: "Liste d'attente",
      value: userId,
      emoji: config.emojis.waitlist,
    });
  }
  return options.length
    ? new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(pid("m-kick-do", match.id)).setPlaceholder("Qui veux-tu retirer ?").addOptions(options.slice(0, 25)),
    )
    : null;
}

/**
 * Point d'entrée unique des interactions du panneau.
 * @returns {Promise<boolean>} true si l'interaction a été prise en charge.
 */
async function handlePanelComponent(interaction) {
  const parsed = parsePanelId(interaction.customId);
  if (!parsed) return false;

  // Garde-fou : les droits sont revérifiés à CHAQUE clic, jamais déduits du
  // fait que la personne a déjà le panneau ouvert.
  if (!access.canOpenPanel(interaction.user.id)) {
    await denied(interaction);
    return true;
  }

  const { action, args } = parsed;
  const userId = interaction.user.id;
  const client = interaction.client;

  // Sections nécessitant une partie : on la résout une bonne fois pour toutes.
  const matchId = ["m-kick", "m-kick-do", "m-swap", "m-swap-do", "m-shuffle", "m-gather", "m-voice", "m-end"].includes(action)
    ? args[0]
    : null;
  const match = matchId ? store.getMatch(matchId) : null;
  if (matchId && !match) {
    await interaction.update(buildMatchList(interaction.guildId));
    return true;
  }

  switch (action) {
    // ---- Ouverture depuis la commande préfixe : réponse strictement privée ----
    case "open":
      await interaction.reply({
        ...buildHome(userId, interaction.guildId),
        flags: MessageFlags.Ephemeral,
      });
      return true;

    // ---- Navigation ----
    case "home":
      await interaction.update(buildHome(userId, interaction.guildId));
      return true;
    case "matches":
      await interaction.update(buildMatchList(interaction.guildId));
      return true;
    case "nav": {
      const section = interaction.values[0];
      if (section === "owners") {
        // Double garde : la section n'est proposée qu'au root, et refusée ici
        // même si quelqu'un rejouait l'interaction.
        if (!access.isRoot(userId)) {
          await interaction.update(buildHome(userId, interaction.guildId));
          return true;
        }
        await interaction.update(await buildOwners(client, userId));
      } else if (section === "managers") await interaction.update(await buildManagers(client));
      else if (section === "matches") await interaction.update(buildMatchList(interaction.guildId));
      else await interaction.update(buildSettings());
      return true;
    }

    // ---- Propriétaires (root uniquement) ----
    case "owner-add":
    case "owner-remove": {
      const targetId = interaction.values[0];
      const result = action === "owner-add"
        ? access.addOwner(userId, targetId)
        : access.removeOwner(userId, targetId);

      const view = await buildOwners(client, userId);
      view.embeds[0].addFields({
        name: config.separator,
        value: result.ok
          ? (action === "owner-add"
            ? `✅ <@${targetId}> est désormais **propriétaire** du bot.`
            : `✅ <@${targetId}> n'est plus propriétaire.`)
          : `❌ ${result.error}`,
      });
      await interaction.update(view);
      if (result.ok) {
        logEvent(client, "access", {
          description: `<@${userId}> a ${action === "owner-add" ? "donné" : "retiré"} l'ownership du bot à <@${targetId}>.`,
        });
      }
      return true;
    }

    // ---- Gestionnaires ----
    case "manager-add":
    case "manager-remove": {
      const targetId = interaction.values[0];
      const result = action === "manager-add"
        ? access.addManager(userId, targetId)
        : access.removeManager(userId, targetId);

      const view = await buildManagers(client);
      view.embeds[0].addFields({
        name: config.separator,
        value: result.ok
          ? (action === "manager-add"
            ? `✅ <@${targetId}> est désormais **gestionnaire**.`
            : `✅ <@${targetId}> n'est plus gestionnaire.`)
          : `❌ ${result.error}`,
      });
      await interaction.update(view);
      if (result.ok) {
        logEvent(client, "access", {
          description: `<@${userId}> a ${action === "manager-add" ? "nommé" : "retiré"} <@${targetId}> comme gestionnaire.`,
        });
      }
      return true;
    }

    // ---- Gestion d'une partie ----
    case "match-pick": {
      const picked = store.getMatch(interaction.values[0]);
      // La partie a pu se terminer pendant que le panneau était ouvert.
      await interaction.update(picked ? buildMatchView(picked) : buildMatchList(interaction.guildId));
      return true;
    }

    case "m-kick": {
      const row = buildKickSelect(match);
      if (!row) {
        await interaction.update(buildMatchView(match, "❌ Aucun joueur à retirer."));
        return true;
      }
      const view = buildMatchView(match, "Sélectionne le joueur à retirer :");
      view.components = [row, ...view.components.slice(-1)];
      await interaction.update(view);
      return true;
    }
    case "m-kick-do": {
      const notice = await doKick(client, match, interaction.values[0], userId);
      await interaction.update(buildMatchView(match, notice));
      return true;
    }

    case "m-swap": {
      const view = buildMatchView(match, "Sélectionne **exactement deux** joueurs à échanger :");
      view.components = [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(pid("m-swap-do", match.id))
            .setPlaceholder("Deux joueurs de la partie…")
            .setMinValues(2)
            .setMaxValues(2),
        ),
        ...view.components.slice(-1),
      ];
      await interaction.update(view);
      return true;
    }
    case "m-swap-do": {
      const notice = await doSwap(client, match, interaction.values, userId);
      await interaction.update(buildMatchView(match, notice));
      return true;
    }

    case "m-shuffle": {
      await interaction.deferUpdate();
      const notice = await doShuffle(client, match, userId);
      await interaction.editReply(buildMatchView(match, notice));
      return true;
    }
    case "m-gather": {
      await interaction.deferUpdate();
      const notice = await doGather(client, match);
      await interaction.editReply(buildMatchView(match, notice));
      return true;
    }
    case "m-voice": {
      await interaction.deferUpdate();
      const notice = await doRecreateVoice(client, match, interaction.channel?.parentId || null);
      await interaction.editReply(buildMatchView(match, notice));
      return true;
    }
    case "m-end": {
      await interaction.deferUpdate();
      const result = await endMatch(client, match, userId);
      const view = buildMatchList(interaction.guildId);
      view.embeds[0].addFields({
        name: config.separator,
        value: result.ok ? `🛑 Partie \`#${match.id}\` terminée, salons vocaux supprimés.` : `❌ ${result.error}`,
      });
      await interaction.editReply(view);
      return true;
    }

    // ---- Réglages ----
    case "set-prefix":
      await interaction.showModal(buildPrefixModal());
      return true;
    case "set-delays":
      await interaction.showModal(buildDelaysModal());
      return true;
    case "toggle": {
      // Liste blanche : un customId forgé ne doit pas pouvoir écrire
      // n'importe quelle clé de réglage.
      const TOGGLEABLE = ["autoPromote", "warnAcceptAnyVoice", "restrictCreation"];
      if (!TOGGLEABLE.includes(args[0])) return false;
      settings.toggle(args[0]);
      await interaction.update(buildSettings());
      return true;
    }
    case "set-log":
    case "set-category": {
      const key = action === "set-log" ? "logChannelId" : "voiceCategoryId";
      settings.set(key, interaction.values[0] || null);
      await interaction.update(buildSettings());
      return true;
    }

    default:
      return false;
  }
}

/** Modales du panneau : préfixe et délais. */
async function handlePanelModal(interaction) {
  const parsed = parsePanelId(interaction.customId);
  if (!parsed || !["delays-modal", "prefix-modal"].includes(parsed.action)) return false;

  if (!access.canOpenPanel(interaction.user.id)) {
    await denied(interaction);
    return true;
  }

  // ---- Changement de préfixe ----
  if (parsed.action === "prefix-modal") {
    const value = interaction.fields.getTextInputValue("prefix").trim();

    // Un préfixe avec un espace, ou vide, rendrait toutes les commandes
    // inatteignables : on refuse plutôt que de casser le bot silencieusement.
    if (!value || /\s/.test(value) || value.length > 5) {
      await interaction.reply({
        embeds: [errorEmbed("Le préfixe doit faire 1 à 5 caractères, sans espace.")],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    settings.set("prefix", value);
    logEvent(interaction.client, "access", {
      description: `<@${interaction.user.id}> a changé le préfixe des commandes en \`${value}\`.`,
    });

    const view = buildSettings();
    if (interaction.isFromMessage()) await interaction.update(view);
    else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
    return true;
  }

  const warn = Number.parseInt(interaction.fields.getTextInputValue("warn"), 10);
  const promote = Number.parseInt(interaction.fields.getTextInputValue("promote"), 10);

  // Bornes volontairement larges mais non nulles : un délai de 0 s rendrait
  // l'avertissement inutilisable, au-delà d'une heure il n'a plus de sens.
  const valid = (value) => Number.isFinite(value) && value >= 5 && value <= 3600;
  if (!valid(warn) || !valid(promote)) {
    await interaction.reply({
      embeds: [errorEmbed("Les délais doivent être des nombres de secondes entre **5** et **3600**.")],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  settings.set("warnMs", warn * 1000);
  settings.set("promoteMs", promote * 1000);

  const view = buildSettings();
  if (interaction.isFromMessage()) await interaction.update(view);
  else await interaction.reply({ ...view, flags: MessageFlags.Ephemeral });
  return true;
}

module.exports = {
  // Bouton posé par la commande `panel` pour ouvrir le panneau en privé.
  OPEN_BUTTON_ID: pid("open"),
  // Vues (exportées aussi pour les tests)
  buildHome, buildOwners, buildManagers, buildMatchList, buildMatchView, buildSettings,
  // Routage
  handlePanelComponent, handlePanelModal, parsePanelId,
};
