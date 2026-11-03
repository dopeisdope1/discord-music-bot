const { ChannelType } = require("discord.js");
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
 * Capture le serveur ENTIER : rôles, catégories, salons (topic, nsfw, mode
 * lent, bitrate, limite vocale), permissions par salon, emojis et — si
 * `messagesPerChannel` > 0 — l'historique récent de chaque salon textuel.
 * Compatible avec les anciennes sauvegardes (structure seule) : les champs
 * ajoutés sont tous optionnels à la restauration.
 */
async function captureGuildStructure(guild, { messagesPerChannel = 0 } = {}) {
  const channels = [...guild.channels.cache.values()]
    .filter((c) => CREATABLE_TYPES.has(c.type))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const roles = [...(guild.roles?.cache?.values() || [])]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
    }));

  const everyonePermissions = guild.roles?.everyone?.permissions?.bitfield?.toString() ?? null;

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
    entry.overwrites = [...(c.permissionOverwrites?.cache?.values() || [])].map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield.toString(),
      deny: o.deny.bitfield.toString(),
    }));
    if (messagesPerChannel > 0 && TEXT_TYPES.has(c.type)) {
      entry.messages = await fetchChannelMessages(c, Math.min(messagesPerChannel, MAX_MESSAGES_PER_CHANNEL));
    }
    return entry;
  };

  const categoriesById = new Map();
  const categories = [];
  for (const c of channels) {
    if (c.type !== ChannelType.GuildCategory) continue;
    const entry = { name: c.name, overwrites: [], channels: [] };
    entry.overwrites = (await serializeChannel(c)).overwrites;
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

  const emojis = [...(guild.emojis?.cache?.values() || [])].map((e) => ({ name: e.name, url: e.imageURL?.({ extension: e.animated ? "gif" : "png" }) || e.url }));

  return {
    sourceGuildId: guild.id,
    sourceGuildName: guild.name,
    createdAt: new Date().toISOString(),
    everyonePermissions,
    roles,
    emojis,
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
 * Recrée rôles, catégories, salons (avec permissions), emojis et messages
 * dans `guild` d'après une sauvegarde. Séquentiel (pas de Promise.all) :
 * les salons d'une catégorie dépendent de l'ID de la catégorie qui vient
 * d'être créée, et Discord limite de toute façon le débit de création.
 */
async function applyStructure(guild, structure) {
  const stats = { rolesCreated: 0, categoriesCreated: 0, channelsCreated: 0, emojisCreated: 0, messagesRestored: 0 };

  // Rôles : du plus haut au plus bas (un nouveau rôle se place juste au-dessus
  // de @everyone, donc créer le plus haut en premier garde l'ordre d'origine).
  const roleMap = new Map();
  if (structure.sourceGuildId) roleMap.set(structure.sourceGuildId, guild.id);
  for (const r of structure.roles || []) {
    const base = { name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable };
    const created =
      (await guild.roles.create({ ...base, permissions: BigInt(r.permissions) }).catch(() => null)) ||
      // Le bot ne peut pas accorder une permission qu'il n'a pas : on recrée le rôle sans.
      (await guild.roles.create(base).catch(() => null));
    if (!created) continue;
    roleMap.set(r.id, created.id);
    stats.rolesCreated++;
  }
  if (structure.everyonePermissions && guild.roles?.everyone?.setPermissions) {
    await guild.roles.everyone.setPermissions(BigInt(structure.everyonePermissions)).catch(() => {});
  }

  const resolveOverwrites = (list = []) =>
    list
      .map((o) => {
        const id = o.type === 0 ? roleMap.get(o.id) : guild.members?.cache?.has(o.id) ? o.id : null;
        return id ? { id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) } : null;
      })
      .filter(Boolean);

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
      permissionOverwrites: resolveOverwrites(ch.overwrites),
    });
    stats.channelsCreated++;
    if (ch.messages?.length) stats.messagesRestored += await restoreMessages(created, ch.messages);
    return created;
  };

  for (const cat of structure.categories) {
    const category = await guild.channels.create({
      name: cat.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: resolveOverwrites(cat.overwrites),
    });
    stats.categoriesCreated++;
    for (const ch of cat.channels) await createChannel(ch, category.id);
  }
  for (const ch of structure.uncategorized || []) await createChannel(ch, null);

  for (const e of structure.emojis || []) {
    const created = await guild.emojis?.create({ attachment: e.url, name: e.name }).catch(() => null);
    if (created) stats.emojisCreated++;
  }

  return stats;
}

function countChannels(structure) {
  return (structure.uncategorized?.length || 0) + structure.categories.reduce((n, c) => n + c.channels.length, 0);
}

function resolveBackup(name) {
  return backupStore.getBackup(name) || PRESET_BACKUPS[name.toLowerCase()] || null;
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

  if (!sub) {
    const presets = Object.keys(PRESET_BACKUPS);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          [
            "`backup <nom> [messages]` — sauvegarde TOUT le serveur : rôles, catégories, salons, permissions, emojis et les `messages` derniers messages de chaque salon textuel (défaut " + DEFAULT_MESSAGES_PER_CHANNEL + ", max " + MAX_MESSAGES_PER_CHANNEL + ", `0` = sans messages)",
            "`backup list` — liste les sauvegardes disponibles",
            "`backup delete <nom>` — supprime une sauvegarde",
            "`backup load <nom>` — restaure une sauvegarde dans CE serveur (confirmation obligatoire)",
            "",
            "Ne sauvegarde PAS : membres et leurs rôles, bans, webhooks, threads, stickers, réglages du serveur (nom, icône...). Les messages sont republiés par webhook (pseudo/avatar d'origine, pas leur vrai auteur).",
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
    const total = countChannels(structure);
    const restore = async (interaction, terminer) => {
      const r = await applyStructure(interaction.guild, structure);
      return terminer(
        "Terminé",
        `**${r.rolesCreated}** rôle(s), **${r.categoriesCreated}** catégorie(s), **${r.channelsCreated}** salon(s), **${r.emojisCreated}** emoji(s) créés, **${r.messagesRestored}** message(s) restauré(s).`
      );
    };
    return requestConfirmation(message, {
      title: "Confirmer la restauration",
      body: `**${total}** salon(s) dans **${structure.categories.length}** catégorie(s) seront créés dans CE serveur, d'après la sauvegarde **${name}** (${structure.sourceGuildName}). Les rôles, permissions par salon, emojis et messages sauvegardés sont aussi recréés. Ça peut prendre plusieurs minutes.`,
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
  const summary = `Sauvegarde **${name}** enregistrée : ${structure.roles.length} rôle(s), ${countChannels(structure)} salon(s) dans ${structure.categories.length} catégorie(s), ${structure.emojis.length} emoji(s), ${nbMessages} message(s).`;
  if (wait?.edit) return wait.edit({ embeds: [buildStatusEmbed("success", summary, { guildId: message.guild.id })] }).catch(() => reply(message, "success", summary));
  return reply(message, "success", summary);
}

module.exports = { backup, captureGuildStructure, applyStructure, resolveBackup, countChannels, PRESET_BACKUPS };
