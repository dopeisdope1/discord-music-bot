const { ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const backupStore = require("./serverBackupStore");
const { requestConfirmation } = require("./serverAdminCommands");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text, { guildId: message.guild.id })] });

// Préréglages intégrés au code (pas dans le store JSON) : servent à
// restaurer un serveur que le BOT n'a plus les moyens de visiter lui-même
// (banni, salon supprimé...) — la personne fournit la structure de mémoire
// une fois, et &backup load la restaure comme n'importe quelle sauvegarde
// normale. "yunara" : saisi à la main depuis des captures d'écran fournies
// par l'utilisateur après un bannissement du bot ET de son compte du
// serveur d'origine — aucun moyen de le récupérer autrement.
const PRESET_BACKUPS = {
  yunara: {
    sourceGuildName: "yunara (saisi à la main depuis des captures d'écran, bot banni du serveur d'origine)",
    createdAt: null,
    categories: [
      {
        name: "Informations",
        channels: [
          { name: "📢・annonce", type: ChannelType.GuildText },
          { name: "🧧・gw", type: ChannelType.GuildText },
          { name: "📜・sondage", type: ChannelType.GuildText },
          { name: "📥・invites", type: ChannelType.GuildText },
          { name: "🏆・stats", type: ChannelType.GuildText },
        ],
      },
      {
        name: "Salons textuels",
        channels: [
          { name: "💬・chat", type: ChannelType.GuildText },
          { name: "📸・médias", type: ChannelType.GuildText },
          { name: "📱・selfies", type: ChannelType.GuildText },
          { name: "🛠️・cmds", type: ChannelType.GuildText },
          { name: "🌺・mudae", type: ChannelType.GuildText },
        ],
      },
      {
        name: "Salons vocaux",
        channels: [
          "ptit s1 gros coeur",
          "10 12 14 bureau",
          "84 c'est city",
          "Itadakimase",
          "wee tehna",
          "Santé Bondy",
          "six sevennn",
          "c nwarr",
          "kc on top",
          "en détente",
          "beleck sa tire",
          "212 & 213",
          "concentrarrr",
          "135 CITY",
        ].map((name) => ({ name, type: ChannelType.GuildVoice })),
      },
      {
        // La liste des "prv" continuait au-delà de prv 6 sur les captures
        // fournies mais a été coupée — seules prv 1 à 6 sont restaurées ici,
        // le reste est à recréer à la main après &backup load si besoin.
        name: "Salons privées",
        channels: [
          { name: "prv 1", type: ChannelType.GuildVoice, userLimit: 2 },
          { name: "prv 2", type: ChannelType.GuildVoice, userLimit: 2 },
          { name: "prv 3", type: ChannelType.GuildVoice, userLimit: 2 },
          { name: "prv 4", type: ChannelType.GuildVoice, userLimit: 3 },
          { name: "prv 5", type: ChannelType.GuildVoice, userLimit: 3 },
          { name: "prv 6", type: ChannelType.GuildVoice, userLimit: 4 },
        ],
      },
    ],
    uncategorized: [{ name: "rules", type: ChannelType.GuildText }],
  },
};

const CREATABLE_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement]);

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const MAX_MESSAGES_PER_CHANNEL = 500;
const DEFAULT_MESSAGES_PER_CHANNEL = 100;

/** Récupère les `limit` derniers messages d'un salon (pagination par 100), du plus ancien au plus récent. */
async function fetchChannelMessages(channel, limit) {
  const collected = [];
  let before;
  while (collected.length < limit) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, limit - collected.length), ...(before ? { before } : {}) }).catch(() => null);
    if (!batch || !batch.size) break;
    collected.push(...batch.values());
    before = batch.last().id;
  }
  return collected
    .reverse()
    .filter((m) => !m.system)
    .map((m) => ({
      authorId: m.author.id,
      authorName: m.member?.displayName || m.author.username,
      authorAvatar: m.author.displayAvatarURL({ extension: "png", size: 128 }),
      content: m.content || "",
      createdAt: m.createdAt.toISOString(),
      attachments: [...m.attachments.values()].map((a) => ({ name: a.name, url: a.url })),
      embeds: m.embeds.filter((e) => e.data?.type === "rich" || !e.data?.type).slice(0, 10).map((e) => e.toJSON()),
      pinned: !!m.pinned,
    }));
}

/**
 * Capture catégories, salons (topic, nsfw, mode lent, bitrate, limite
 * vocale) et — si
 * `messagesPerChannel` > 0 — l'historique récent de chaque salon textuel.
 * Compatible avec les anciennes sauvegardes (structure seule) : les champs
 * ajoutés sont tous optionnels à la restauration.
 */
async function captureGuildStructure(guild, { messagesPerChannel = 0 } = {}) {
  const channels = [...guild.channels.cache.values()]
    .filter((c) => CREATABLE_TYPES.has(c.type))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const serializeChannel = async (c) => {
    const entry = { name: c.name, type: c.type };
    if (c.type === ChannelType.GuildVoice) {
      if (c.userLimit) entry.userLimit = c.userLimit;
      if (c.bitrate) entry.bitrate = c.bitrate;
    }
    if (TEXT_TYPES.has(c.type)) {
      if (c.topic) entry.topic = c.topic;
      if (c.nsfw) entry.nsfw = true;
      if (c.rateLimitPerUser) entry.rateLimitPerUser = c.rateLimitPerUser;
    }
    if (messagesPerChannel > 0 && TEXT_TYPES.has(c.type)) {
      entry.messages = await fetchChannelMessages(c, Math.min(messagesPerChannel, MAX_MESSAGES_PER_CHANNEL));
    }
    return entry;
  };

  const categoriesById = new Map();
  const categories = [];
  for (const c of channels) {
    if (c.type !== ChannelType.GuildCategory) continue;
    const entry = { name: c.name, channels: [] };
    categoriesById.set(c.id, entry);
    categories.push(entry);
  }

  const uncategorized = [];
  for (const c of channels) {
    if (c.type === ChannelType.GuildCategory) continue;
    const entry = await serializeChannel(c);
    const target = c.parentId && categoriesById.get(c.parentId);
    if (target) target.channels.push(entry);
    else uncategorized.push(entry);
  }

  return {
    sourceGuildId: guild.id,
    sourceGuildName: guild.name,
    createdAt: new Date().toISOString(),
    categories,
    uncategorized,
  };
}

/** Rejoue des messages sauvegardés dans un salon via un webhook (pseudo + avatar d'origine). */
async function restoreMessages(channel, messages) {
  const webhook = await channel.createWebhook({ name: "Restauration" }).catch(() => null);
  if (!webhook) return 0;
  let sent = 0;
  for (const m of messages) {
    const files = (m.attachments || []).map((a) => a.url);
    const content = [m.content, ...files].filter(Boolean).join("\n").slice(0, 2000);
    if (!content && !(m.embeds || []).length) continue;
    const ok = await webhook
      .send({
        username: (m.authorName || "Inconnu").slice(0, 80),
        avatarURL: m.authorAvatar,
        content: content || undefined,
        embeds: m.embeds?.length ? m.embeds : undefined,
        allowedMentions: { parse: [] },
      })
      .then(() => true)
      .catch(() => false);
    if (ok) sent++;
  }
  await webhook.delete().catch(() => {});
  return sent;
}

/**
 * Recrée catégories, salons et messages
 * dans `guild` d'après une sauvegarde. Séquentiel (pas de Promise.all) :
 * les salons d'une catégorie dépendent de l'ID de la catégorie qui vient
 * d'être créée, et Discord limite de toute façon le débit de création.
 */
async function applyStructure(guild, structure) {
  const stats = { categoriesCreated: 0, channelsCreated: 0, messagesRestored: 0 };

  const createChannel = async (ch, parent) => {
    const created = await guild.channels.create({
      name: ch.name,
      type: ch.type,
      ...(parent ? { parent } : {}),
      ...(ch.topic ? { topic: ch.topic } : {}),
      ...(ch.nsfw ? { nsfw: true } : {}),
      ...(ch.rateLimitPerUser ? { rateLimitPerUser: ch.rateLimitPerUser } : {}),
      ...(ch.type === ChannelType.GuildVoice && ch.userLimit ? { userLimit: ch.userLimit } : {}),
      ...(ch.type === ChannelType.GuildVoice && ch.bitrate ? { bitrate: Math.min(ch.bitrate, guild.maximumBitrate || ch.bitrate) } : {}),
    });
    stats.channelsCreated++;
    if (ch.messages?.length) stats.messagesRestored += await restoreMessages(created, ch.messages);
    return created;
  };

  for (const cat of structure.categories) {
    const category = await guild.channels.create({
      name: cat.name,
      type: ChannelType.GuildCategory,
    });
    stats.categoriesCreated++;
    for (const ch of cat.channels) await createChannel(ch, category.id);
  }
  for (const ch of structure.uncategorized || []) await createChannel(ch, null);

  return stats;
}

function countChannels(structure) {
  return (structure.uncategorized?.length || 0) + structure.categories.reduce((n, c) => n + c.channels.length, 0);
}

function resolveBackup(name) {
  return backupStore.getBackup(name) || PRESET_BACKUPS[name.toLowerCase()] || null;
}

const PANEL_ID = "backuppanel";

function listAll() {
  const presets = Object.keys(PRESET_BACKUPS).map((name) => ({
    name,
    sourceGuildName: PRESET_BACKUPS[name].sourceGuildName,
    createdAt: null,
    channelCount: countChannels(PRESET_BACKUPS[name]),
    messageCount: 0,
    preset: true,
  }));
  return [...backupStore.listBackups(), ...presets];
}

/** Panel de `&backup` : les serveurs sauvegardés, et un menu pour en restaurer un ICI. */
function buildBackupPanel() {
  const all = listAll();
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Sauvegardes de serveurs"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  if (!all.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("Aucun serveur sauvegardé.\nSauvegarde celui-ci avec `backup <nom> [messages]`."));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }
  const shown = all.slice(0, 25);
  const date = (b) => (b.createdAt ? `<t:${Math.floor(new Date(b.createdAt).getTime() / 1000)}:d>` : "—");
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      shown.map((b) => `**${b.name}**${b.preset ? " *(préréglage)*" : ""}\n> ${b.sourceGuildName} · ${b.channelCount} salon(s) · ${b.messageCount} message(s) · ${date(b)}`).join("\n\n") +
        (all.length > shown.length ? `\n\n… et ${all.length - shown.length} autre(s) (\`backup list\`)` : "")
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PANEL_ID}:pick`)
        .setPlaceholder("Restaurer une sauvegarde dans CE serveur…")
        .addOptions(shown.map((b) => ({ label: b.name.slice(0, 100), description: `${b.sourceGuildName} · ${b.channelCount} salon(s)`.slice(0, 100), value: b.name })))
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function handleBackupPanelInteraction(interaction) {
  if (!can(interaction.member, "sys")) {
    return interaction.reply({ content: "Tu n'as pas accès à cette commande.", flags: MessageFlags.Ephemeral });
  }
  const name = interaction.values?.[0];
  const structure = name && resolveBackup(name);
  if (!structure) return interaction.reply({ content: "Sauvegarde introuvable.", flags: MessageFlags.Ephemeral });
  return askRestore({ author: interaction.user, guild: interaction.guild, reply: (payload) => interaction.reply(payload) }, name, structure);
}

/** Demande confirmation puis restaure la sauvegarde `name` dans le serveur de `message`. */
function askRestore(message, name, structure, options = {}) {
  const total = countChannels(structure);
  const restore = async (interaction, terminer) => {
    const r = await applyStructure(interaction.guild, structure);
    return terminer(
      "Terminé",
      `**${r.categoriesCreated}** catégorie(s) et **${r.channelsCreated}** salon(s) créés, **${r.messagesRestored}** message(s) restauré(s).`
    );
  };
  return requestConfirmation(message, {
    title: "Confirmer la restauration",
    body: `**${total}** salon(s) dans **${structure.categories.length}** catégorie(s) seront créés dans CE serveur, d'après la sauvegarde **${name}** (${structure.sourceGuildName}). Les messages sauvegardés sont aussi republiés. Ça peut prendre plusieurs minutes.`,
    confirmLabel: "Restaurer",
    permission: "sys",
    execute: options.doubleConfirm
      ? async (interaction) => {
          // `interaction` (le clic "Continuer") n'a pas encore été
          // accusé réception : .reply() ici sert de premier accusé ET
          // remplace le message par la seconde confirmation, plutôt que
          // .update() qui n'aurait fait qu'éditer la première carte sans
          // en garder de trace distincte. `retour` transmis : sinon la
          // restauration finale perdrait le retour au panel entre les deux
          // confirmations.
          const secondMessage = {
            author: message.author,
            guild: interaction.guild,
            retour: message.retour,
            reply: (payload) => interaction.reply(payload),
          };
          return requestConfirmation(secondMessage, {
            title: "Dernière confirmation",
            body: `Aucun retour en arrière automatique : **${total}** salon(s) vont être créés maintenant dans **${interaction.guild.name}**, d'après **${name}**.`,
            confirmLabel: "Restaurer maintenant",
            permission: "sys",
            execute: restore,
          });
        }
      : restore,
  });
}

/**
 * @param {{ doubleConfirm?: boolean }} [options] `doubleConfirm` ajoute une
 * seconde confirmation avant `load` (restauration) — demandé explicitement
 * pour l'accès depuis &panel, où un mauvais clic est plus facile qu'en tapant
 * la commande. `&backup load` au clavier garde sa confirmation unique
 * inchangée (options omis).
 */
async function backup(client, message, args, options = {}) {
  if (!can(message.member, "sys")) return;
  const sub = (args[0] || "").toLowerCase();

  if (!sub) return message.reply(buildBackupPanel());

  if (sub === "help") {
    const presets = Object.keys(PRESET_BACKUPS);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          [
            "`backup <nom> [messages]` — sauvegarde les catégories, salons et les `messages` derniers messages de chaque salon textuel (défaut " + DEFAULT_MESSAGES_PER_CHANNEL + ", max " + MAX_MESSAGES_PER_CHANNEL + ", `0` = sans messages)",
            "`backup list` — liste les sauvegardes disponibles",
            "`backup delete <nom>` — supprime une sauvegarde",
            "`backup load <nom>` — restaure une sauvegarde dans CE serveur (confirmation obligatoire)",
            "",
            "Ne sauvegarde PAS : rôles, permissions par salon, emojis, membres, bans, threads. Les messages sont republiés par webhook (pseudo/avatar d'origine, pas leur vrai auteur).",
            presets.length ? `Préréglages intégrés (pas besoin d'avoir été sauvegardés) : ${presets.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          { title: "Sauvegarde de serveur", guildId: message.guild.id }
        ),
      ],
    });
  }

  if (sub === "list") {
    const saved = backupStore.listBackups();
    const presets = Object.keys(PRESET_BACKUPS).map((name) => ({ name, sourceGuildName: PRESET_BACKUPS[name].sourceGuildName, channelCount: countChannels(PRESET_BACKUPS[name]), preset: true }));
    const all = [...presets, ...saved];
    if (!all.length) return reply(message, "info", "Aucune sauvegarde enregistrée.");
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          all.map((b) => `> **${b.name}**${b.preset ? " *(préréglage)*" : ""} — ${b.channelCount} salon(s) — ${b.sourceGuildName}`).join("\n"),
          { title: "Sauvegardes disponibles", guildId: message.guild.id }
        ),
      ],
    });
  }

  if (sub === "delete") {
    const name = args[1];
    if (!name) return reply(message, "error", "Indique un nom : `backup delete <nom>`.");
    if (PRESET_BACKUPS[name.toLowerCase()] && !backupStore.getBackup(name)) {
      return reply(message, "error", "C'est un préréglage intégré au code, il ne peut pas être supprimé par commande.");
    }
    const deleted = backupStore.deleteBackup(name);
    return reply(message, deleted ? "success" : "error", deleted ? `Sauvegarde **${name}** supprimée.` : `Aucune sauvegarde nommée **${name}**.`);
  }

  if (sub === "load") {
    const name = args[1];
    if (!name) return reply(message, "error", "Indique un nom : `backup load <nom>`.");
    const structure = resolveBackup(name);
    if (!structure) return reply(message, "error", `Aucune sauvegarde nommée **${name}** (voir \`backup list\`).`);
    return askRestore(message, name, structure, options);
  }

  // Pas un mot-clé connu : c'est le NOM sous lequel sauvegarder l'état actuel.
  const name = args[0];
  if (PRESET_BACKUPS[name.toLowerCase()] && !backupStore.getBackup(name)) {
    return reply(
      message,
      "error",
      `**${name}** est un préréglage intégré au code — l'écraser masquerait la structure d'origine. Utilise \`backup load ${name}\` pour le restaurer, ou choisis un autre nom pour sauvegarder l'état actuel.`
    );
  }
  let messagesPerChannel = DEFAULT_MESSAGES_PER_CHANNEL;
  if (args[1] !== undefined) {
    messagesPerChannel = Number.parseInt(args[1], 10);
    if (!Number.isInteger(messagesPerChannel) || messagesPerChannel < 0) {
      return reply(message, "error", "Le nombre de messages doit être un entier positif : `backup <nom> [messages]`.");
    }
  }
  const wait = messagesPerChannel > 0 ? await reply(message, "info", "Sauvegarde en cours (les messages peuvent prendre un moment)…").catch(() => null) : null;
  const structure = await captureGuildStructure(message.guild, { messagesPerChannel });
  backupStore.saveBackup(name, structure);
  const nbMessages = [...structure.categories.flatMap((c) => c.channels), ...structure.uncategorized].reduce((n, c) => n + (c.messages?.length || 0), 0);
  const summary = `Sauvegarde **${name}** enregistrée : ${countChannels(structure)} salon(s) dans ${structure.categories.length} catégorie(s), ${nbMessages} message(s).`;
  if (wait?.edit) return wait.edit({ embeds: [buildStatusEmbed("success", summary, { guildId: message.guild.id })] }).catch(() => reply(message, "success", summary));
  return reply(message, "success", summary);
}

module.exports = { backup, handleBackupPanelInteraction, PANEL_ID, buildBackupPanel, captureGuildStructure, applyStructure, resolveBackup, countChannels, PRESET_BACKUPS };
