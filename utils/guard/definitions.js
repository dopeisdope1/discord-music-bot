const { AuditLogEvent, PermissionsBitField } = require("discord.js");
const {
  handleAuditEntry,
  isFullyExempt,
  applyPunishment,
  recordOccurrence,
  clearOccurrences,
  punishmentCapReached,
  recordPunishment,
} = require("./engine");
const guardConfig = require("./config");
const { postModerationEntry } = require("../moderationLog");

// Seuils "en rafale" par défaut : 3 occurrences en 10s, même ordre de
// grandeur que le CrowBot pour les modules équivalents. Les actions les
// plus dangereuses (threshold: null) se déclenchent dès la première fois.
const BURST = { count: 3, windowMs: 10_000 };

const DEFINITIONS = [
  {
    key: "antibot",
    label: "Bot ajouté sans autorisation",
    auditEvent: AuditLogEvent.BotAdd,
    threshold: null,
  },
  {
    key: "antiwebhook",
    label: "Webhook créé sans autorisation",
    auditEvent: AuditLogEvent.WebhookCreate,
    threshold: null,
  },
  {
    key: "antirole-admin",
    label: "Administrateur donné à un rôle",
    auditEvent: AuditLogEvent.RoleUpdate,
    threshold: null,
    // Ne se déclenche que si CE changement précis ajoute Administrateur —
    // un renommage ou un changement de couleur du même rôle ne compte pas.
    matches: (entry) => {
      const change = entry.changes.find((c) => c.key === "permissions");
      if (!change) return false;
      const before = new PermissionsBitField(BigInt(change.old || 0));
      const after = new PermissionsBitField(BigInt(change.new || 0));
      return !before.has(PermissionsBitField.Flags.Administrator) && after.has(PermissionsBitField.Flags.Administrator);
    },
  },
  { key: "antichannel", label: "Rafale de création de salons", auditEvent: AuditLogEvent.ChannelCreate, threshold: BURST },
  { key: "antichanneldelete", label: "Rafale de suppression de salons", auditEvent: AuditLogEvent.ChannelDelete, threshold: BURST },
  { key: "antirole", label: "Rafale de création de rôles", auditEvent: AuditLogEvent.RoleCreate, threshold: BURST },
  { key: "antiroledelete", label: "Rafale de suppression de rôles", auditEvent: AuditLogEvent.RoleDelete, threshold: BURST },
  {
    key: "antikick",
    label: "Rafale d'expulsions",
    auditEvent: AuditLogEvent.MemberKick,
    threshold: BURST,
    // Contrairement au ban, Discord ne permet pas de "dé-expulser" quelqu'un
    // — la sanction sur l'exécuteur est la seule réponse possible ici.
  },
  {
    key: "antiban",
    label: "Rafale de bannissements",
    auditEvent: AuditLogEvent.MemberBanAdd,
    threshold: BURST,
    revert: async (entry, guild) => {
      if (entry.targetId) await guild.bans.remove(entry.targetId, "Anti-nuke : annulation automatique").catch(() => {});
    },
  },
  {
    key: "antiunban",
    label: "Rafale de débannissements",
    auditEvent: AuditLogEvent.MemberBanRemove,
    threshold: BURST,
    revert: async (entry, guild) => {
      if (entry.targetId) await guild.members.ban(entry.targetId, { reason: "Anti-nuke : re-bannissement automatique" }).catch(() => {});
    },
  },
];

const BY_EVENT = new Map();
for (const def of DEFINITIONS) {
  if (!BY_EVENT.has(def.auditEvent)) BY_EVENT.set(def.auditEvent, []);
  BY_EVENT.get(def.auditEvent).push(def);
}

/**
 * À appeler pour CHAQUE entrée du journal d'audit (voir index.js,
 * guildAuditLogEntryCreate) — en plus de utils/moderationLog.js, pas à sa
 * place. Ne fait rien si aucun guard ne suit ce type d'événement.
 */
async function checkAuditEntry(client, guild, entry) {
  const defs = BY_EVENT.get(entry.action);
  if (!defs) return;
  for (const def of defs) {
    if (def.matches && !def.matches(entry)) continue;
    await handleAuditEntry(client, guild, entry, def).catch((err) => console.error(`[guard:${def.key}]`, err));
  }
}

// --- antieveryone : pas d'audit log fiable pour un simple message, hooké
// directement sur messageCreate (voir index.js), même famille que
// utils/automod/antiSpam.js::checkMessage. ---
async function checkEveryoneMention(client, message) {
  if (message.author.bot || !message.guild || !message.member) return;
  if (!message.mentions.everyone) return;

  const config = guardConfig.getConfig(message.guild.id);
  if (!guardConfig.isGuardEnabled(message.guild.id, "antieveryone")) return;
  if (isFullyExempt(message.member)) return;

  await message.delete().catch(() => {});

  const capped = punishmentCapReached(message.guild.id);
  const punished = capped
    ? false
    : await applyPunishment(client, message.guild, message.member, config, "Anti-nuke : mention @everyone/@here non autorisée");
  if (punished) recordPunishment(message.guild.id);

  await postModerationEntry(client, message.guild.id, "moderation", {
    title: "Anti-nuke — Mention @everyone/@here non autorisée",
    fields: [
      { label: "Exécuteur", value: `<@${message.author.id}> (${message.author.id})` },
      { label: "Salon", value: `<#${message.channel.id}> (${message.channel.id})` },
      { label: "Sanction", value: punished ? config.punishment : "aucune (protégé)" },
    ],
    moderatorTag: "Anti-nuke (automatique)",
    pingRoleId: config.pingRoleId,
  });
}

// --- antijoin : afflux de joins, aucun exécuteur (ce sont les comptes qui
// rejoignent le problème, pas quelqu'un qui agit sur eux) — rate-based,
// même mécanique que utils/automod/antiSpam.js. ---
const JOIN_FLOOD = { count: 5, windowMs: 10_000 };

async function checkJoinFlood(client, member) {
  if (!guardConfig.isGuardEnabled(member.guild.id, "antijoin")) return;
  if (isFullyExempt(member)) return;

  const count = recordOccurrence(member.guild.id, "__joins__", "antijoin", JOIN_FLOOD.windowMs);
  if (count < JOIN_FLOOD.count) return;
  clearOccurrences(member.guild.id, "__joins__", "antijoin");

  if (punishmentCapReached(member.guild.id)) {
    console.warn(`[guard:antijoin] plafond de sanctions atteint sur "${member.guild.name}", membre non expulsé (log conservé).`);
    return;
  }
  await member.kick("Anti-nuke : afflux de joins suspect").catch((err) => console.error("[guard:antijoin]", err.message));
  recordPunishment(member.guild.id);

  await postModerationEntry(client, member.guild.id, "moderation", {
    title: "Anti-nuke — Afflux de joins suspect",
    fields: [{ label: "Dernier membre expulsé", value: `<@${member.id}> (${member.id})` }],
    moderatorTag: "Anti-nuke (automatique)",
    pingRoleId: guardConfig.getConfig(member.guild.id).pingRoleId,
  });
}

// --- creationlimit : compte trop récent pour rejoindre sans être sanctionné
// — "&antinuke creationlimit <durée>", désactivé tant qu'aucun seuil n'est
// réglé (creationLimitMs = 0). Contrairement à antijoin (débit anormal de
// joins), ça se déclenche sur CHAQUE arrivée dont le compte est trop jeune,
// indépendamment du rythme des arrivées. ---
async function checkNewAccount(client, member) {
  if (!guardConfig.isGuardEnabled(member.guild.id, "creationlimit")) return;
  const config = guardConfig.getConfig(member.guild.id);
  if (!config.creationLimitMs) return;
  if (isFullyExempt(member)) return;
  if (Date.now() - member.user.createdTimestamp >= config.creationLimitMs) return;

  if (punishmentCapReached(member.guild.id)) {
    console.warn(`[guard:creationlimit] plafond de sanctions atteint sur "${member.guild.name}", membre non sanctionné (log conservé).`);
    return;
  }
  const punished = await applyPunishment(client, member.guild, member, config, "Anti-nuke : compte trop récent pour rejoindre");
  if (punished) recordPunishment(member.guild.id);

  await postModerationEntry(client, member.guild.id, "moderation", {
    title: "Anti-nuke — Compte trop récent",
    fields: [
      { label: "Membre", value: `<@${member.id}> (${member.id})` },
      { label: "Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
      { label: "Sanction", value: punished ? config.punishment : "aucune (protégé, ou plafond de sanctions atteint)" },
    ],
    moderatorTag: "Anti-nuke (automatique)",
    pingRoleId: config.pingRoleId,
  });
}

// Liste complète pour le panel (&panel > Anti-nuke) : les guards basés sur
// l'audit log + antieveryone/antijoin/creationlimit, qui n'y figurent pas
// (déclenchés autrement, voir plus haut) mais sont individuellement
// activables/désactivables au même titre via guardConfig.isGuardEnabled/
// toggleGuard.
const ALL_GUARDS = [
  ...DEFINITIONS.map((d) => ({ key: d.key, label: d.label, threshold: d.threshold })),
  { key: "antieveryone", label: "Mention @everyone/@here non autorisée", threshold: null },
  { key: "antijoin", label: "Afflux de joins suspect", threshold: JOIN_FLOOD },
  { key: "creationlimit", label: "Compte trop récent pour rejoindre", threshold: null },
];

module.exports = { DEFINITIONS, ALL_GUARDS, checkAuditEntry, checkEveryoneMention, checkJoinFlood, checkNewAccount };
