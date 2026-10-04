const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkHierarchyById, checkBotPermission, report } = require("./moderation/actions");
const { formatDuration } = require("./moderationCommands");
const zinkillerStore = require("./zinkillerStore");
const { repondreAvecBlacklistCard } = require("./blacklistCard");
const listNavigator = require("./listNavigator");

// "-zinkiller"/"-unzinkiller" — ban PERSISTANT : re-banni automatiquement si
// quelqu'un le débannit autrement que par -unzinkiller (Discord natif, un
// autre bot...) — voir l'écouteur guildBanRemove dans index.js et
// utils/zinkillerStore.js. Distinct de -ban/-unban (utils/banPanel.js), qui
// restent un bannissement Discord ordinaire, sans ce filet.
// "-zinkiller <@membre>" ouvre la carte interactive (utils/blacklistCard.js,
// raisons -> preuves -> confirmation) — plus de tokens texte (raisonid:/
// preuve:/grade:/duree:), remplacés par l'UX carte demandée.
const PERMISSION = "moderation.zinkiller";

const reply = (message, kind, text) => message.reply(buildStatusEmbed(kind, text, { guildId: message.guild.id }));

function parseTarget(args) {
  const mention = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const id = args[0]?.match(/^\d{15,25}$/);
  return mention?.[1] || id?.[0] || null;
}

/** "-zinkiller <@membre|id>" — ouvre la carte "Blacklist · raisons". Fonctionne même si la cible n'est pas (encore) sur le serveur : elle sera bannie par avance, comme un ban Discord normal par ID. */
async function zinkiller(client, message, args) {
  if (!can(message.member, PERMISSION)) return;

  const targetId = parseTarget(args);
  if (!targetId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `zinkiller @membre|id`.");
  if (targetId === message.author.id) return reply(message, "error", "Tu ne peux pas agir sur toi-même.");

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
  const refusal = targetMember
    ? checkHierarchy(message.guild, message.member, targetMember)
    : checkHierarchyById(message.guild, message.member, targetId);
  if (refusal) return reply(message, "error", refusal);

  const targetUser = targetMember?.user || (await client.users.fetch(targetId).catch(() => null));
  if (!targetUser) return reply(message, "error", "Identifiant Discord introuvable.");

  return repondreAvecBlacklistCard(message, targetUser);
}

/** "-unzinkiller <@membre|id>" — débannit et retire le ban persistant. */
async function unzinkiller(client, message, args) {
  if (!can(message.member, PERMISSION)) return;

  const targetId = parseTarget(args);
  if (!targetId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `unzinkiller @membre|id`.");

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const existing = await message.guild.bans.fetch(targetId).catch(() => null);
  if (!existing) return reply(message, "error", "Cet identifiant ne figure pas dans la liste des bannis.");

  const removed = zinkillerStore.remove(message.guild.id, targetId);

  try {
    await message.guild.bans.remove(targetId, `Unzinkiller par ${message.author.tag}`);
  } catch (err) {
    if (removed) zinkillerStore.add(message.guild.id, targetId, removed);
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  await report(client, {
    guildId: message.guild.id,
    title: "Blacklist retirée",
    fields: [
      { label: "Cible", value: `<@${targetId}> (${targetId})` },
      ...(removed?.grade ? [{ label: "Grade appliqué", value: removed.grade }] : []),
      { label: "Ban sur ny", value: "levé" },
    ],
    action: "unzinkiller",
    targetId,
    targetTag: existing.user.tag,
    moderator: message.author,
    channelId: message.channel.id,
  });

  return reply(message, "success", `**${existing.user.tag}** débanni, le ban persistant est retiré.`);
}

/** "-blinfo <@membre|id>" — consultation d'une entrée blacklist (lecture seule), comme "-baninfo" pour un ban classique. */
async function blinfo(client, message, args) {
  if (!can(message.member, "logs.view")) return;
  const targetId = parseTarget(args);
  if (!targetId) return reply(message, "error", "Indique un identifiant : `blinfo <id>`.");

  const entry = zinkillerStore.get(message.guild.id, targetId);
  if (!entry) return reply(message, "info", "Aucune entrée blacklist enregistrée pour cet identifiant.");

  const lignes = [
    `**Cible** : <@${targetId}> (${targetId})`,
    `**Auteur** : <@${entry.moderatorId}>`,
    entry.reason ? `**Raison** : ${entry.reason}` : null,
    entry.grade ? `**Grade** : ${entry.grade}` : null,
    entry.preuve ? `**Preuve** : ${entry.preuve}` : null,
    entry.note ? `**Texte** : ${entry.note}` : null,
    `**Durée** : ${entry.expiresAt ? `expire <t:${Math.floor(entry.expiresAt / 1000)}:R>` : "permanente"}`,
    `**Depuis** : <t:${Math.floor(entry.at / 1000)}:F>`,
  ].filter(Boolean);
  return reply(message, "info", lignes.join("\n"));
}

/** Appelé périodiquement (voir index.js) pour débannir les blacklist temporaires arrivées à échéance. */
async function checkExpiredZinkillers(client) {
  const expired = zinkillerStore.getExpired();
  for (const entry of expired) {
    zinkillerStore.remove(entry.guildId, entry.userId);
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;
    await guild.bans.remove(entry.userId, "Fin de la blacklist temporaire").catch(() => {});
    await report(client, {
      guildId: entry.guildId,
      title: "Blacklist retirée — expiration",
      fields: [
        { label: "Cible", value: `<@${entry.userId}> (${entry.userId})` },
        ...(entry.grade ? [{ label: "Grade appliqué", value: entry.grade }] : []),
        { label: "Ban sur ny", value: "levé" },
      ],
      action: "zinkiller_expire",
      targetId: entry.userId,
      targetTag: null,
      moderator: client.user,
      channelId: null,
    }).catch(() => {});
  }
}

/** "-zinkillerlist" — membres sous ban persistant sur ce serveur, un seul message paginé. */
async function zinkillerlist(client, message) {
  if (!can(message.member, PERMISSION)) return;
  return listNavigator.repondreAvecListe("zinkillerlist", message);
}

listNavigator.registerProvider("zinkillerlist", (guild) => {
  const entries = zinkillerStore.list(guild.id);
  return {
    title: "Bans persistants",
    vide: "Aucun ban persistant actif sur ce serveur.",
    numerote: true,
    lines: entries.map((e) =>
      [
        `<@${e.userId}> (${e.userId}) — par <@${e.moderatorId}>`,
        e.grade ? `grade ${e.grade}` : null,
        e.reason ? `raison : ${e.reason}` : null,
        e.preuve ? `preuve : ${e.preuve}` : null,
        e.expiresAt ? `fin : <t:${Math.floor(e.expiresAt / 1000)}:R>` : "permanente",
      ]
        .filter(Boolean)
        .join(" — ")
    ),
  };
});

module.exports = { zinkiller, unzinkiller, blinfo, zinkillerlist, checkExpiredZinkillers };
