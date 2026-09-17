const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const zinkillerStore = require("./zinkillerStore");

// "&zinkiller"/"&unzinkiller" — ban PERSISTANT : re-banni automatiquement si
// quelqu'un le débannit autrement que par &unzinkiller (Discord natif, un
// autre bot...) — voir l'écouteur guildBanRemove dans index.js et
// utils/zinkillerStore.js. Distinct de &ban/&unban (utils/banPanel.js), qui
// restent un bannissement Discord ordinaire, sans ce filet.
const PERMISSION = "moderation.zinkiller";

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

function parseTarget(args) {
  const mention = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const id = args[0]?.match(/^\d{15,25}$/);
  return mention?.[1] || id?.[0] || null;
}

/** "&zinkiller <@membre|id> [raison]" — bannit et rend le bannissement persistant. */
async function zinkiller(client, message, args) {
  if (!can(message.member, PERMISSION)) return;

  const targetId = parseTarget(args);
  if (!targetId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `zinkiller @membre|id [raison]`.");
  if (targetId === message.author.id) return reply(message, "error", "Tu ne peux pas agir sur toi-même.");

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers");
  if (botPerm) return reply(message, "error", botPerm);

  // La cible peut ne pas être (plus) sur le serveur — un ban persistant sert
  // aussi à barrer la route à quelqu'un qui a déjà quitté. La hiérarchie ne
  // s'applique donc que si elle est encore membre.
  const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
  if (targetMember) {
    const refusal = checkHierarchy(message.guild, message.member, targetMember);
    if (refusal) return reply(message, "error", refusal);
  }

  const reason = args.slice(1).join(" ") || null;
  const targetTag = targetMember?.user.tag || targetId;

  try {
    await message.guild.members.ban(targetId, { reason: reason || `zinkiller — par ${message.author.tag}` });
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  zinkillerStore.add(message.guild.id, targetId, { reason, moderatorId: message.author.id });

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Zinkiller",
    fields: [{ label: "Cible", value: `<@${targetId}> (${targetId})` }],
    action: "zinkiller",
    targetId,
    targetTag,
    moderator: message.author,
    reason,
    channelId: message.channel.id,
  });

  return reply(message, "success", `**${targetTag}** banni et re-banni automatiquement s'il est débanni ailleurs que par \`unzinkiller\`.`);
}

/** "&unzinkiller <@membre|id>" — débannit et retire le ban persistant. */
async function unzinkiller(client, message, args) {
  if (!can(message.member, PERMISSION)) return;

  const targetId = parseTarget(args);
  if (!targetId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `unzinkiller @membre|id`.");

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const existing = await message.guild.bans.fetch(targetId).catch(() => null);
  if (!existing) return reply(message, "error", "Cet identifiant ne figure pas dans la liste des bannis.");

  // Retiré AVANT le débannissement : guildBanRemove (index.js) ne doit pas
  // voir une entrée encore présente et re-bannir dans la foulée.
  const removed = zinkillerStore.remove(message.guild.id, targetId);

  try {
    await message.guild.bans.remove(targetId, `Unzinkiller par ${message.author.tag}`);
  } catch (err) {
    // Le débannissement a échoué : le ban persistant doit rester en place,
    // sinon un prochain débannissement (par quelqu'un d'autre) ne serait
    // plus jamais re-banni.
    if (removed) zinkillerStore.add(message.guild.id, targetId, removed);
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Unzinkiller",
    fields: [{ label: "Cible", value: `<@${targetId}> (${targetId})` }],
    action: "unzinkiller",
    targetId,
    targetTag: existing.user.tag,
    moderator: message.author,
    channelId: message.channel.id,
  });

  return reply(message, "success", `**${existing.user.tag}** débanni, le ban persistant est retiré.`);
}

/** "&zinkillerlist" — membres sous ban persistant sur ce serveur. */
async function zinkillerlist(client, message) {
  if (!can(message.member, PERMISSION)) return;

  const entries = zinkillerStore.list(message.guild.id);
  if (!entries.length) return reply(message, "info", "Aucun ban persistant actif sur ce serveur.");

  const lines = entries
    .slice(0, 40)
    .map((e) => `<@${e.userId}> (${e.userId}) — par <@${e.moderatorId}>${e.reason ? ` — ${e.reason}` : ""}`);
  const extra = entries.length > 40 ? `\n\n…et ${entries.length - 40} autre(s).` : "";
  return reply(message, "info", `**${entries.length} ban(s) persistant(s)** :\n${lines.join("\n")}${extra}`);
}

module.exports = { zinkiller, unzinkiller, zinkillerlist };
