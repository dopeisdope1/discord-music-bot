const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const { deleteMessages } = require("./deleteMessages");
const historyStore = require("./moderationHistoryStore");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/** Menu de traduction des durées "&timeout @membre 10m" -> millisecondes. Plafond Discord : 28 jours. */
const DURATION_UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_TIMEOUT_MS = 28 * 86_400_000;

function parseDuration(text) {
  const match = (text || "").trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const ms = parseInt(match[1], 10) * DURATION_UNITS[match[2].toLowerCase()];
  return ms > 0 ? Math.min(ms, MAX_TIMEOUT_MS) : null;
}

function formatDuration(ms) {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return [days && `${days}j`, hours && `${hours}h`, minutes && `${minutes}min`, seconds && `${seconds}s`]
    .filter(Boolean)
    .join(" ") || "0s";
}

/** Sépare la cible (mention ou identifiant) du reste — même logique que utils/banPanel.js::parseTarget. */
function parseTarget(message, args) {
  const rest = args.join(" ").trim();
  const mentioned = message.mentions.users?.first();
  const idMatch = rest.match(/\d{15,25}/);
  return {
    targetId: mentioned?.id || idMatch?.[0] || null,
    rest: rest
      .replace(/<@!?\d+>/g, "")
      .replace(/\d{15,25}/, "")
      .trim(),
  };
}

async function fetchTargetOrReply(message, targetId, { label = "membre" } = {}) {
  if (!targetId) {
    await reply(message, "error", `Indique un ${label} (mention ou identifiant).`);
    return null;
  }
  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    await reply(message, "error", "Ce membre n'est pas sur le serveur.");
    return null;
  }
  return target;
}

/**
 * Résout un membre ET un rôle depuis les args de &addrole/&delrole — mention
 * OU identifiant pour chacun (règle du cahier des charges : "les paramètres
 * peuvent être des noms, des mentions, ou des IDs"). Les mentions
 * s'identifient d'elles-mêmes (<@id> vs <@&id>) ; les IDs bruts restants
 * sont résolus en tentant le rôle d'abord (lookup en cache, immédiat), puis
 * le membre (fetch), pour ne jamais confondre les deux.
 */
async function resolveMemberAndRole(message, args) {
  let member = message.mentions.members?.first() || null;
  let role = message.mentions.roles?.first() || null;

  const rawIds = args.filter((a) => /^\d{15,25}$/.test(a));
  for (const id of rawIds) {
    if (!role) {
      const maybeRole = message.guild.roles.cache.get(id);
      if (maybeRole) {
        role = maybeRole;
        continue;
      }
    }
    if (!member) {
      const maybeMember = await message.guild.members.fetch(id).catch(() => null);
      if (maybeMember) member = maybeMember;
    }
  }
  return { member, role };
}

/** Corps commun de &addrole/&delrole (voir plus bas) : `sub` vaut "add" ou "remove". */
async function roleMembership(client, message, args, sub) {
  if (!can(message.member, "members.role")) return;
  const { member: mentionedMember, role: mentionedRole } = await resolveMemberAndRole(message, args);
  if (!mentionedMember || !mentionedRole) {
    return reply(
      message,
      "error",
      `Indique un membre ET un rôle (mention ou ID) : \`${sub === "add" ? "addrole" : "delrole"} @membre|id @rôle|id\`.`
    );
  }

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const refusal = checkHierarchy(message.guild, message.member, mentionedMember);
  if (refusal) return reply(message, "error", refusal);

  // Hiérarchie sur le RÔLE lui-même, distincte de la hiérarchie sur la
  // cible : attribuer un rôle plus haut que le sien reste interdit même
  // si la cible, elle, est en dessous.
  const me = message.guild.members.me;
  if (me.roles.highest.position <= mentionedRole.position) {
    return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
  }
  if (message.member.id !== message.guild.ownerId && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    if (message.member.roles.highest.position <= mentionedRole.position) {
      return reply(message, "error", "Tu ne peux pas gérer un rôle supérieur ou égal au tien.");
    }
  }

  const already = mentionedMember.roles.cache.has(mentionedRole.id);
  if (sub === "add" && already) return reply(message, "info", `${mentionedMember.user.tag} a déjà ce rôle.`);
  if (sub === "remove" && !already) return reply(message, "info", `${mentionedMember.user.tag} n'a pas ce rôle.`);

  try {
    if (sub === "add") await mentionedMember.roles.add(mentionedRole, `Rôle ajouté par ${message.author.tag}`);
    else await mentionedMember.roles.remove(mentionedRole, `Rôle retiré par ${message.author.tag}`);
  } catch (err) {
    console.error("[role] échec :", err);
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }
  await report(client, {
    guildId: message.guild.id,
    category: "members",
    title: sub === "add" ? "Rôle ajouté" : "Rôle retiré",
    fields: [
      { label: "Cible", value: `<@${mentionedMember.id}> (${mentionedMember.id})` },
      { label: "Rôle", value: mentionedRole.name },
    ],
    action: "role",
    targetId: mentionedMember.id,
    targetTag: mentionedMember.user.tag,
    moderator: message.author,
    channelId: message.channel.id,
    extra: sub === "add" ? { added: [mentionedRole.id] } : { removed: [mentionedRole.id] },
  });
  await reply(
    message,
    "success",
    `Rôle **${mentionedRole.name}** ${sub === "add" ? "ajouté à" : "retiré de"} **${mentionedMember.user.tag}**.`
  );
}

const handlers = {
  async kick(client, message, args) {
    if (!can(message.member, "moderation.kick")) return;
    const { targetId, rest: reason } = parseTarget(message, args);
    const target = await fetchTargetOrReply(message, targetId);
    if (!target) return;

    const refusal =
      checkBotPermission(message.guild, PermissionFlagsBits.KickMembers, "KickMembers") ||
      checkHierarchy(message.guild, message.member, target);
    if (refusal) return reply(message, "error", refusal);

    const tag = target.user.tag;
    try {
      await target.kick(reason || `Expulsion par ${message.author.tag}`);
    } catch (err) {
      console.error("[kick] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "moderation",
      title: "Expulsion",
      fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
      action: "kick",
      targetId: target.id,
      targetTag: tag,
      moderator: message.author,
      reason,
      channelId: message.channel.id,
    });
    await reply(message, "success", `**${tag}** a été expulsé.${reason ? `\nRaison : ${reason}` : ""}`);
  },

  async softban(client, message, args) {
    if (!can(message.member, "moderation.softban")) return;
    const { targetId, rest: reason } = parseTarget(message, args);
    const target = await fetchTargetOrReply(message, targetId);
    if (!target) return;

    const refusal =
      checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers") ||
      checkHierarchy(message.guild, message.member, target);
    if (refusal) return reply(message, "error", refusal);

    const tag = target.user.tag;
    try {
      // Bannir puis débannir aussitôt : purge l'historique récent des
      // messages sans bannir réellement — c'est tout l'intérêt du softban.
      await target.ban({ reason: reason || `Softban par ${message.author.tag}`, deleteMessageSeconds: 86400 });
      await message.guild.bans.remove(target.id, `Softban (purge) par ${message.author.tag}`);
    } catch (err) {
      console.error("[softban] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "moderation",
      title: "Softban",
      fields: [
        { label: "Cible", value: `<@${target.id}> (${target.id})` },
        { label: "Messages purgés", value: "dernières 24h" },
      ],
      action: "softban",
      targetId: target.id,
      targetTag: tag,
      moderator: message.author,
      reason,
      channelId: message.channel.id,
    });
    await reply(message, "success", `**${tag}** a été softban (messages des dernières 24h purgés).${reason ? `\nRaison : ${reason}` : ""}`);
  },

  async timeout(client, message, args) {
    if (!can(message.member, "moderation.timeout")) return;
    const { targetId, rest } = parseTarget(message, args);
    const target = await fetchTargetOrReply(message, targetId);
    if (!target) return;

    const [durationText, ...reasonParts] = rest.split(/\s+/);
    const ms = parseDuration(durationText);
    if (!ms) {
      return reply(message, "error", "Indique une durée valide : `10s`, `10m`, `1h`, `1d` (max 28 jours).");
    }
    const reason = reasonParts.join(" ").trim();

    const refusal =
      checkBotPermission(message.guild, PermissionFlagsBits.ModerateMembers, "ModerateMembers") ||
      checkHierarchy(message.guild, message.member, target);
    if (refusal) return reply(message, "error", refusal);

    const tag = target.user.tag;
    try {
      await target.timeout(ms, reason || `Timeout par ${message.author.tag}`);
    } catch (err) {
      console.error("[timeout] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "moderation",
      title: "Timeout",
      fields: [
        { label: "Cible", value: `<@${target.id}> (${target.id})` },
        { label: "Durée", value: formatDuration(ms) },
      ],
      action: "timeout",
      targetId: target.id,
      targetTag: tag,
      moderator: message.author,
      reason,
      channelId: message.channel.id,
      extra: { durationMs: ms },
    });
    await reply(message, "success", `**${tag}** est en timeout pour **${formatDuration(ms)}**.${reason ? `\nRaison : ${reason}` : ""}`);
  },

  async untimeout(client, message, args) {
    if (!can(message.member, "moderation.timeout")) return;
    const { targetId } = parseTarget(message, args);
    const target = await fetchTargetOrReply(message, targetId);
    if (!target) return;

    const refusal =
      checkBotPermission(message.guild, PermissionFlagsBits.ModerateMembers, "ModerateMembers") ||
      checkHierarchy(message.guild, message.member, target);
    if (refusal) return reply(message, "error", refusal);

    if (!target.communicationDisabledUntil) {
      return reply(message, "info", `**${target.user.tag}** n'est pas en timeout.`);
    }

    const tag = target.user.tag;
    try {
      await target.timeout(null, `Fin de timeout par ${message.author.tag}`);
    } catch (err) {
      console.error("[untimeout] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "moderation",
      title: "Fin de timeout",
      fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
      action: "untimeout",
      targetId: target.id,
      targetTag: tag,
      moderator: message.author,
      channelId: message.channel.id,
    });
    await reply(message, "success", `Timeout de **${tag}** levé.`);
  },

  async slowmode(client, message, args) {
    if (!can(message.member, "channels.slowmode")) return;
    const target = message.mentions.channels?.first() || message.channel;
    if (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement) {
      return reply(message, "error", "Le mode lent ne s'applique qu'à un salon textuel.");
    }

    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
    if (botPerm) return reply(message, "error", botPerm);

    const arg = (args.find((a) => !a.startsWith("<#")) || "").toLowerCase();
    let seconds;
    if (arg === "off" || arg === "0") seconds = 0;
    else {
      const match = arg.match(/^(\d+)\s*(s|m|h)?$/);
      if (!match) return reply(message, "error", "Indique une durée : `5s`, `10s`, `1m`, ou `off` pour désactiver.");
      const unit = match[2] || "s";
      seconds = parseInt(match[1], 10) * (unit === "h" ? 3600 : unit === "m" ? 60 : 1);
    }
    // Plafond Discord : 6 heures.
    seconds = Math.min(seconds, 21_600);

    try {
      await target.setRateLimitPerUser(seconds, `Mode lent réglé par ${message.author.tag}`);
    } catch (err) {
      console.error("[slowmode] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: seconds ? "Mode lent" : "Mode lent désactivé",
      fields: [
        { label: "Salon", value: `<#${target.id}> (${target.id})` },
        ...(seconds ? [{ label: "Durée", value: `${seconds}s` }] : []),
      ],
      action: "slowmode",
      targetId: target.id,
      targetTag: null,
      moderator: message.author,
      channelId: message.channel.id,
      extra: { seconds },
    });
    await reply(message, "success", seconds ? `Mode lent réglé sur **${seconds}s** dans <#${target.id}>.` : `Mode lent désactivé dans <#${target.id}>.`);
  },

  async nick(client, message, args) {
    if (!can(message.member, "members.nick")) return;
    const mentioned = message.mentions.members?.first();
    if (!mentioned) return reply(message, "error", "Indique un membre : `nick @membre <pseudo>`.");
    const newNick = args
      .filter((a) => !a.startsWith("<@"))
      .join(" ")
      .trim();
    if (!newNick) return reply(message, "error", "Indique le nouveau pseudo.");
    if (newNick.length > 32) return reply(message, "error", "Le pseudo ne peut pas dépasser 32 caractères.");

    const refusal =
      checkBotPermission(message.guild, PermissionFlagsBits.ManageNicknames, "ManageNicknames") ||
      checkHierarchy(message.guild, message.member, mentioned);
    if (refusal) return reply(message, "error", refusal);

    try {
      await mentioned.setNickname(newNick, `Pseudo changé par ${message.author.tag}`);
    } catch (err) {
      console.error("[nick] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "moderation",
      title: "Pseudo modifié",
      fields: [
        { label: "Cible", value: `<@${mentioned.id}> (${mentioned.id})` },
        { label: "Nouveau pseudo", value: newNick },
      ],
      action: "nick",
      targetId: mentioned.id,
      targetTag: mentioned.user.tag,
      moderator: message.author,
      channelId: message.channel.id,
      extra: { to: newNick },
    });
    await reply(message, "success", `Pseudo de **${mentioned.user.tag}** réglé sur **${newNick}**.`);
  },

  async resetnick(client, message, args) {
    if (!can(message.member, "members.nick")) return;
    const mentioned = message.mentions.members?.first();
    if (!mentioned) return reply(message, "error", "Indique un membre : `resetnick @membre`.");

    const refusal =
      checkBotPermission(message.guild, PermissionFlagsBits.ManageNicknames, "ManageNicknames") ||
      checkHierarchy(message.guild, message.member, mentioned);
    if (refusal) return reply(message, "error", refusal);

    try {
      await mentioned.setNickname(null, `Pseudo réinitialisé par ${message.author.tag}`);
    } catch (err) {
      console.error("[resetnick] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "moderation",
      title: "Pseudo réinitialisé",
      fields: [{ label: "Cible", value: `<@${mentioned.id}> (${mentioned.id})` }],
      action: "nick",
      targetId: mentioned.id,
      targetTag: mentioned.user.tag,
      moderator: message.author,
      channelId: message.channel.id,
      extra: { to: null },
    });
    await reply(message, "success", `Pseudo de **${mentioned.user.tag}** réinitialisé.`);
  },

  async addrole(client, message, args) {
    return roleMembership(client, message, args, "add");
  },

  async delrole(client, message, args) {
    return roleMembership(client, message, args, "remove");
  },

  async userinfo(client, message, args) {
    const mentioned = message.mentions.members?.first() || message.member;
    const roles = [...mentioned.roles.cache.values()]
      .filter((r) => r.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => r.toString());
    const lines = [
      `**Utilisateur** : ${mentioned.user.tag} (${mentioned.id})`,
      `**A rejoint le serveur** : ${mentioned.joinedAt ? `<t:${Math.floor(mentioned.joinedTimestamp / 1000)}:f>` : "inconnu"}`,
      `**Compte créé** : <t:${Math.floor(mentioned.user.createdTimestamp / 1000)}:f>`,
      mentioned.communicationDisabledUntil ? `**En timeout jusqu'à** : <t:${Math.floor(mentioned.communicationDisabledUntilTimestamp / 1000)}:f>` : null,
      `**Rôles (${roles.length})** : ${roles.length ? roles.join(", ") : "*aucun*"}`,
    ].filter(Boolean);
    await message.reply({
      embeds: [buildStatusEmbed("info", lines.join("\n"), { title: "Informations membre", thumbnail: mentioned.user.displayAvatarURL() })],
    });
  },

  async modlogs(client, message, args) {
    if (!can(message.member, "logs.view")) return;
    const mentioned = message.mentions.users?.first();
    const idArg = args.find((a) => /^\d{15,25}$/.test(a));
    const targetId = mentioned?.id || idArg || null;

    const results = historyStore.search(message.guild.id, { targetId, limit: 10 });
    if (!results.length) {
      return reply(message, "info", targetId ? "Aucune entrée pour ce membre." : "Aucune entrée d'historique pour l'instant.");
    }
    const lines = results.map((e) => {
      const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
      return `\`${e.action}\` ${e.targetTag ? `**${e.targetTag}**` : ""} — par ${e.moderatorTag || e.moderatorId} — ${when}${e.reason ? ` — ${e.reason}` : ""}`;
    });
    await message.reply({
      embeds: [buildStatusEmbed("info", lines.join("\n"), { title: `Historique de modération${targetId ? " — membre ciblé" : ""}` })],
    });
  },
};

// --- &clear (ciblé uniquement : @membre ou id, jamais en aveugle) ---

const DEFAULT_CLEAR_COUNT = 50;
const MAX_CLEAR_COUNT = 200;
const MAX_CLEAR_SCAN = 500;

async function clear(client, message, args) {
  if (!can(message.member, "moderation.clear")) return;

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageMessages, "ManageMessages");
  if (botPerm) return reply(message, "error", botPerm);

  // La cible doit être le PREMIER argument (pas juste "une mention présente
  // quelque part dans le message") : sinon "&clear sanctions @membre" —
  // sous-commande documentée mais pas encore implémentée, voir le catalogue
  // — supprimerait réellement les messages de ce membre au lieu d'échouer
  // proprement, `sanctions` étant alors pris pour du texte ignoré.
  const mentionMatch = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const idMatch = args[0]?.match(/^\d{15,25}$/);
  const targetUserId = mentionMatch?.[1] || idMatch?.[0];
  if (!targetUserId) {
    return reply(message, "error", "Indique un membre : `clear @membre [nombre]` ou `clear <id> [nombre]`.");
  }
  const remaining = args.slice(1);

  let count = DEFAULT_CLEAR_COUNT;
  const n = parseInt(remaining[0], 10);
  if (!isNaN(n) && n > 0) count = n;
  count = Math.min(count, MAX_CLEAR_COUNT);

  // Toujours par lots de 100 (le maximum que Discord accepte par requête)
  // jusqu'à réunir assez de messages de cette cible ou atteindre le plafond
  // de scan, pour ne jamais déclencher un nombre non borné d'appels sur un
  // salon très actif.
  let toDelete = [];
  let before;
  let scanned = 0;
  while (toDelete.length < count && scanned < MAX_CLEAR_SCAN) {
    const batch = await message.channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    scanned += batch.size;
    for (const m of batch.values()) {
      if (m.author.id === targetUserId) toDelete.push(m);
      if (toDelete.length >= count) break;
    }
    before = [...batch.values()].pop()?.id;
  }

  if (!toDelete.length) {
    return reply(message, "info", "Aucun message de ce membre à supprimer.");
  }

  const deleted = await deleteMessages(message.channel, toDelete);

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Suppression de messages",
    fields: [
      { label: "Cible", value: `<@${targetUserId}> (${targetUserId})` },
      { label: "Salon", value: `<#${message.channel.id}> (${message.channel.id})` },
      { label: "Nombre", value: String(deleted) },
    ],
    action: "clear",
    targetId: targetUserId,
    targetTag: null,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { count: deleted, targetUserId },
  });

  // Confirmation supprimée instantanément après l'envoi : le salon de logs
  // (voir report ci-dessus) garde la trace permanente, pas besoin que celle-ci
  // reste affichée dans le salon nettoyé.
  const confirmation = await message.channel
    .send({ embeds: [buildStatusEmbed("success", `**${deleted}** message(s) supprimé(s).`)] })
    .catch(() => null);
  if (confirmation) confirmation.delete().catch(() => {});
}

// --- &lockdown / &panic (section 24, périmètre réduit — voir le plan) ---

async function lockdown(client, message) {
  if (!can(message.member, "channels.lockdown")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const everyone = message.guild.roles.everyone;
  const channels = message.guild.channels.cache.filter(
    (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && c.manageable
  );

  let locked = 0;
  for (const channel of channels.values()) {
    const already = channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.SendMessages);
    if (already) continue;
    await channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason: `Lockdown déclenché par ${message.author.tag}` }).catch(() => {});
    locked += 1;
  }

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Lockdown",
    fields: [{ label: "Salons verrouillés", value: String(locked) }],
    action: "lockdown",
    targetId: null,
    targetTag: null,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { locked },
  });
  await reply(message, "success", `Lockdown activé : **${locked}** salon(s) verrouillé(s).`);
}

async function unlockdown(client, message) {
  if (!can(message.member, "channels.lockdown")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const everyone = message.guild.roles.everyone;
  const channels = message.guild.channels.cache.filter(
    (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && c.manageable
  );

  let unlocked = 0;
  for (const channel of channels.values()) {
    const denied = channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.SendMessages);
    if (!denied) continue;
    await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason: `Fin du lockdown par ${message.author.tag}` }).catch(() => {});
    unlocked += 1;
  }

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Fin du lockdown",
    fields: [{ label: "Salons déverrouillés", value: String(unlocked) }],
    action: "unlockdown",
    targetId: null,
    targetTag: null,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { unlocked },
  });
  await reply(message, "success", `Lockdown levé : **${unlocked}** salon(s) déverrouillé(s).`);
}

module.exports = {
  moderationHandlers: { ...handlers, clear, purge: clear, lockdown, panic: lockdown, unlockdown },
  formatDuration,
  parseDuration,
};
