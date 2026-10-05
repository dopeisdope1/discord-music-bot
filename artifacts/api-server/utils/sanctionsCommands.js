const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const { deleteMessages } = require("./deleteMessages");
const historyStore = require("./moderationHistoryStore");
const muteStore = require("./muteStore");

// Commandes de SANCTION (kick/softban/mute=timeout/unmute=untimeout/modlogs/clear/
// lockdown/panic/unlockdown) — fusionnées depuis moderation-bot. Distinct de
// utils/moderationCommands.js, qui garde slowmode/nick/resetnick/addrole/
// delrole/userinfo (gestion générale, jamais parti vers moderation-bot).
// Réponses en embed simple (buildStatusEmbed) comme à l'origine sur
// moderation-bot — pas de carte visuelle (utils/actionCard.js), pour rester
// cohérent avec le reste des commandes de sanction fusionnées dans ce fichier.

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text, { guildId: message.guild.id })] });

/** Traduction des durées "&mute @membre 10m" -> millisecondes. Plafond Discord : 28 jours. */
const DURATION_UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_TIMEOUT_MS = 28 * 86_400_000;
// &mute sans durée : le maximum que Discord autorise pour un timeout natif.
// Pour un mute vraiment illimité, c'est &permmute (rôle de mute).
const DEFAULT_MUTE_MS = MAX_TIMEOUT_MS;

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

/** Sépare la cible (mention ou identifiant) du reste. */
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

  /**
   * &mute <@membre> [durée] [raison] (alias historique : &timeout) — timeout
   * NATIF Discord : rien à configurer, visible directement dans l'interface
   * Discord, levé automatiquement à l'échéance. Sans durée : 28 jours (le
   * plafond Discord). Pour un mute sans échéance : &permmute.
   */
  async timeout(client, message, args) {
    if (!can(message.member, "moderation.timeout")) return;
    const { targetId, rest } = parseTarget(message, args);
    const target = await fetchTargetOrReply(message, targetId);
    if (!target) return;

    const [premier = "", ...suite] = rest.split(/\s+/).filter(Boolean);
    let ms = parseDuration(premier);
    let reason;
    if (ms) {
      reason = suite.join(" ").trim();
    } else if (/^\d/.test(premier)) {
      // "10", "10 min", "2sem"... : une durée mal tapée ne doit JAMAIS
      // retomber silencieusement sur 28 jours avec la durée prise pour raison.
      return reply(message, "error", "Durée invalide : `10s`, `10m`, `1h`, `1d` (max 28 jours). Sans durée : 28 jours.");
    } else {
      ms = DEFAULT_MUTE_MS;
      reason = rest.trim();
    }

    const refusal =
      checkBotPermission(message.guild, PermissionFlagsBits.ModerateMembers, "ModerateMembers") ||
      checkHierarchy(message.guild, message.member, target);
    if (refusal) return reply(message, "error", refusal);

    const tag = target.user.tag;
    try {
      await target.timeout(ms, reason || `Mute par ${message.author.tag}`);
    } catch (err) {
      console.error("[mute] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      title: "Mute (timeout Discord)",
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
    await reply(message, "success", `**${tag}** est mute pour **${formatDuration(ms)}**.${reason ? `\nRaison : ${reason}` : ""}`);
  },

  /** &unmute <@membre> (alias historique : &untimeout) — lève le timeout natif posé par &mute. */
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
      // Mute illimité (rôle) : ce n'est pas un timeout, &unmute n'y touche pas.
      const muteRoleId = muteStore.getMuteRoleId(message.guild.id);
      if (muteRoleId && target.roles.cache?.has(muteRoleId)) {
        return reply(message, "info", `**${target.user.tag}** n'est pas en timeout mais a le rôle de mute — utilise \`permunmute\`.`);
      }
      return reply(message, "info", `**${target.user.tag}** n'est pas mute.`);
    }

    const tag = target.user.tag;
    try {
      await target.timeout(null, `Démute par ${message.author.tag}`);
    } catch (err) {
      console.error("[unmute] échec :", err);
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      title: "Démute (fin du timeout)",
      fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
      action: "untimeout",
      targetId: target.id,
      targetTag: tag,
      moderator: message.author,
      channelId: message.channel.id,
    });
    await reply(message, "success", `**${tag}** n'est plus mute.`);
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
    const titre = `Historique de modération${targetId ? " — membre ciblé" : ""}`;
    return message.reply({ embeds: [buildStatusEmbed("info", lines.join("\n"), { title: titre, guildId: message.guild.id })] });
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

  const mentionMatch = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const idMatch = args[0]?.match(/^\d{15,25}$/);
  const targetUserId = mentionMatch?.[1] || idMatch?.[0];

  if (!targetUserId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `clear @membre|id [nombre]`.");
  const remaining = args.slice(1);

  let count = DEFAULT_CLEAR_COUNT;
  const n = parseInt(remaining[0], 10);
  if (!isNaN(n) && n > 0) count = n;
  count = Math.min(count, MAX_CLEAR_COUNT);

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

  await message.delete().catch(() => {});
  const confirmation = await message.channel
    .send({ embeds: [buildStatusEmbed("success", `**${deleted}** message(s) supprimé(s).`, { guildId: message.guild.id })] })
    .catch(() => null);
  if (confirmation) confirmation.delete().catch(() => {});
}

// --- &lockdown / &panic / &unlockdown ---

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
  sanctionsHandlers: { ...handlers, clear, purge: clear, lockdown, panic: lockdown, unlockdown },
  formatDuration,
  parseDuration,
};
