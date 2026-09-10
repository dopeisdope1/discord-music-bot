const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { carteSanctionMessage, repondreAvecCarte } = require("./actionCard");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const { formatDuration, parseDuration } = require("./moderationCommands");
const historyStore = require("./moderationHistoryStore");
const muteStore = require("./muteStore");
const tempBanStore = require("./tempBanStore");

// Extensions du catalogue Modération/Paramètres de modération documentées
// dans le panel mais pas encore câblées — voir utils/commandCatalog.js.

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/** Cible = PREMIER argument exactement (mention ou ID) — jamais "une mention trouvée n'importe où" (voir le fix &clear). */
function parseTarget(args) {
  const mentionMatch = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const idMatch = args[0]?.match(/^\d{15,25}$/);
  return mentionMatch?.[1] || idMatch?.[0] || null;
}

async function fetchTargetOrReply(message, targetId, { label = "membre" } = {}) {
  if (!targetId) {
    await reply(message, "error", `Indique un ${label} (mention ou identifiant) en premier argument.`);
    return null;
  }
  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    await reply(message, "error", "Ce membre n'est pas sur le serveur.");
    return null;
  }
  return target;
}

// --- Rôle de mute (&muterole, &set muterole) ---

async function muterole(client, message) {
  if (!can(message.member, "protection.automod")) return;
  const roleId = muteStore.getMuteRoleId(message.guild.id);
  if (!roleId || !message.guild.roles.cache.has(roleId)) {
    return reply(message, "info", "Aucun rôle de mute configuré. Utilise `set muterole @rôle`.");
  }
  return reply(message, "info", `Rôle de mute configuré : <@&${roleId}>.`);
}

/** Appelée par le dispatcher &set (voir utils/musicCommands.js) pour la sous-commande "muterole". */
async function setMuteRole(client, message, args) {
  if (!can(message.member, "protection.automod")) return;
  const role = message.mentions.roles?.first();
  if (!role) return reply(message, "error", "Indique un rôle : `set muterole @rôle`.");
  muteStore.setMuteRoleId(message.guild.id, role.id);
  await reply(
    message,
    "success",
    `Rôle de mute réglé sur ${role}. Ce rôle doit lui-même refuser Envoyer des messages/Parler sur tes salons — ` +
      "le bot ne fait qu'attribuer/retirer ce rôle, pas les permissions du rôle."
  );
}

async function requireMuteRole(message) {
  const roleId = muteStore.getMuteRoleId(message.guild.id);
  const role = roleId ? message.guild.roles.cache.get(roleId) : null;
  if (!role) {
    await reply(message, "error", "Aucun rôle de mute configuré. Utilise `set muterole @rôle` d'abord.");
    return null;
  }
  return role;
}

// --- &mute / &tempmute / &unmute (+ &cmute/&tempcmute/&uncmute, même mécanisme) ---

async function muteMember(client, message, args, { temporary }) {
  if (!can(message.member, "moderation.timeout")) return;
  const role = await requireMuteRole(message);
  if (!role) return;

  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const refusal = checkHierarchy(message.guild, message.member, target);
  if (refusal) return reply(message, "error", refusal);

  let durationMs = null;
  let reasonArgs = args.slice(1);
  if (temporary) {
    durationMs = parseDuration(args[1]);
    if (!durationMs) return reply(message, "error", "Indique une durée valide : `tempmute @membre 10m [raison]`.");
    reasonArgs = args.slice(2);
  }
  const reason = reasonArgs.join(" ").trim() || null;

  if (target.roles.cache.has(role.id)) return reply(message, "info", `${target.user.tag} est déjà mute.`);

  try {
    await target.roles.add(role, `Mute par ${message.author.tag}${reason ? ` : ${reason}` : ""}`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  if (temporary) muteStore.addTempMute(message.guild.id, target.id, Date.now() + durationMs);

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: temporary ? "Mute temporaire" : "Mute",
    fields: [
      { label: "Cible", value: `<@${target.id}> (${target.id})` },
      ...(temporary ? [{ label: "Durée", value: formatDuration(durationMs) }] : []),
    ],
    action: temporary ? "tempmute" : "mute",
    targetId: target.id,
    targetTag: target.user.tag,
    moderator: message.author,
    reason,
    channelId: message.channel.id,
  });

  const carteMute = await carteSanctionMessage({
    action: temporary ? "tempmute" : "mute",
    cible: target,
    moderateur: message.author,
    raison: reason,
    duree: temporary ? formatDuration(durationMs) : "Jusqu'à démute",
    serveur: message.guild.name,
  });
  return repondreAvecCarte(message, carteMute, () =>
    reply(message, "success", `**${target.user.tag}** mute${temporary ? ` pour ${formatDuration(durationMs)}` : ""}.`)
  );

  await reply(
    message,
    "success",
    `**${target.user.tag}** mute${temporary ? ` pour ${formatDuration(durationMs)}` : ""}.`
  );
}

async function unmuteMember(client, message, args) {
  if (!can(message.member, "moderation.timeout")) return;
  const role = await requireMuteRole(message);
  if (!role) return;

  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  if (!target.roles.cache.has(role.id)) return reply(message, "info", `${target.user.tag} n'est pas mute.`);

  try {
    await target.roles.remove(role, `Démute par ${message.author.tag}`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }
  muteStore.removeTempMute(message.guild.id, target.id);

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Démute",
    fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
    action: "unmute",
    targetId: target.id,
    targetTag: target.user.tag,
    moderator: message.author,
    channelId: message.channel.id,
  });
  const carteUnmute = await carteSanctionMessage({ action: "unmute", cible: target, moderateur: message.author, serveur: message.guild.name });
  return repondreAvecCarte(message, carteUnmute, () =>
    reply(message, "success", `**${target.user.tag}** n'est plus mute.`)
  );
  await reply(message, "success", `**${target.user.tag}** n'est plus mute.`);
}

async function mutelist(client, message) {
  if (!can(message.member, "moderation.timeout")) return;
  const role = await requireMuteRole(message);
  if (!role) return;
  const members = role.members;
  if (!members.size) return reply(message, "info", "Personne n'est mute actuellement.");
  const lines = [...members.values()].slice(0, 50).map((m) => `<@${m.id}>`);
  return reply(message, "info", `**${members.size} membre(s) mute** :\n${lines.join(", ")}`);
}

async function unmuteall(client, message) {
  if (!can(message.member, "moderation.unmuteall")) return;
  const role = await requireMuteRole(message);
  if (!role) return;

  const members = [...role.members.values()];
  let count = 0;
  const echecs = [];
  for (const m of members) {
    // `count++` etait incremente MEME quand le retrait echouait : la commande
    // annoncait donc des demutes qui n'avaient pas eu lieu. Un rapport faux
    // est pire qu'un silence.
    try {
      await m.roles.remove(role, `Démute de masse par ${message.author.tag}`);
      count++;
    } catch (err) {
      echecs.push(`${m.user?.tag || m.id} (${err.message})`);
    }
  }
  if (echecs.length) {
    console.error(`[unmuteall] ${echecs.length} echec(s) : ${echecs.join(", ")}`);
  }
  muteStore.clearTempMutes(message.guild.id);

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Démute de masse",
    fields: [{ label: "Membres démute", value: String(count) }],
    action: "unmuteall",
    targetId: null,
    targetTag: null,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { count },
  });
  await reply(message, "success", `**${count}** membre(s) démute.`);
}

/** Appelé périodiquement (voir index.js) pour lever les mutes temporaires arrivés à échéance. */
async function checkExpiredMutes(client) {
  const expired = muteStore.getExpiredTempMutes();
  for (const entry of expired) {
    muteStore.removeTempMute(entry.guildId, entry.userId);
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;
    const roleId = muteStore.getMuteRoleId(entry.guildId);
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    if (!role) continue;
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!member || !member.roles.cache.has(role.id)) continue;
    // Un echec laisse la personne MUETTE indefiniment, alors que sa sanction
    // est terminee. On journalise, et surtout on n'annonce pas une fin de mute
    // qui n'a pas eu lieu.
    try {
      await member.roles.remove(role, "Fin du mute temporaire");
    } catch (err) {
      console.error(`[tempmute] fin de mute impossible pour ${member.id} : ${err.message}`);
      continue;
    }
    await report(client, {
      guildId: entry.guildId,
      category: "moderation",
      title: "Fin du mute temporaire",
      fields: [{ label: "Cible", value: `<@${member.id}> (${member.id})` }],
      action: "unmute",
      targetId: member.id,
      targetTag: member.user.tag,
      moderator: client.user,
      channelId: null,
    }).catch(() => {});
  }
}

// --- Sanctions (&sanctions, &del sanction, &clear sanctions, &clear all sanctions) ---

async function sanctions(client, message, args) {
  if (!can(message.member, "logs.view")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const entries = historyStore.search(message.guild.id, { targetId: target.id, limit: 15 });
  if (!entries.length) return reply(message, "info", `Aucune sanction enregistrée pour **${target.user.tag}**.`);

  const lines = entries.map((e) => {
    const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
    return `**Case #${e.caseNumber}** \`${e.action}\` — par ${e.moderatorTag || e.moderatorId} — ${when}${e.reason ? ` — ${e.reason}` : ""}`;
  });
  return reply(message, "info", `**Sanctions de ${target.user.tag}** (${entries.length}) :\n${lines.join("\n")}`);
}

/**
 * &baninfo <@membre|id> — détail du DERNIER bannissement enregistré pour cet
 * identifiant. Contrairement à &sanctions, ne résout PAS la cible via
 * guild.members.fetch : la personne bannie n'est justement plus sur le
 * serveur, un fetch échouerait toujours.
 */
async function baninfo(client, message, args) {
  if (!can(message.member, "logs.view")) return;
  const targetId = parseTarget(args);
  if (!targetId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `baninfo <@membre|id>`.");

  const entry = historyStore.search(message.guild.id, { targetId, action: "ban", limit: 1 })[0];
  if (!entry) return reply(message, "info", "Aucun bannissement enregistré pour cet identifiant.");

  const when = `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:F>`;
  const lignes = [
    `**Case #${entry.caseNumber}** — <@${targetId}> (${targetId})`,
    `Par : ${entry.moderatorTag || entry.moderatorId}`,
    `Quand : ${when}`,
  ];
  if (entry.reason) lignes.push(`Raison : ${entry.reason}`);
  return reply(message, "info", lignes.join("\n"));
}

async function delSanction(client, message, args) {
  if (!can(message.member, "logs.manage")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  // Numéro de CASE permanent (utils/moderationHistoryStore.js), pas une
  // position recalculée à chaque appel — avant, ajouter/supprimer une
  // sanction entre deux `&sanctions` pouvait faire viser `<n>` sur la
  // mauvaise entrée.
  const caseNumber = parseInt(args[1], 10);
  if (!Number.isInteger(caseNumber) || caseNumber < 1) return reply(message, "error", "Indique un numéro : `del sanction @membre <nombre>` (voir `&sanctions`).");

  const entry = historyStore.search(message.guild.id, { targetId: target.id, caseNumber })[0];
  if (!entry) return reply(message, "error", "Aucune sanction à ce numéro.");

  historyStore.deleteById(message.guild.id, entry.id);
  return reply(message, "success", `Sanction \`${entry.action}\` (case #${entry.caseNumber}) supprimée de l'historique de **${target.user.tag}**.`);
}

async function clearSanctions(client, message, args) {
  if (!can(message.member, "logs.manage")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const removed = historyStore.deleteAllForTarget(message.guild.id, target.id);
  return reply(message, "success", `${removed} sanction(s) supprimée(s) pour **${target.user.tag}**.`);
}

async function clearAllSanctions(client, message) {
  if (!can(message.member, "logs.manage")) return;
  const removed = historyStore.deleteAllForGuild(message.guild.id);
  return reply(message, "success", `${removed} sanction(s) supprimée(s) sur tout le serveur.`);
}

// --- Avertissements (&warn, &warnings, &unwarn) — même historique que les
// sanctions ci-dessus (utils/moderationHistoryStore.js), juste une valeur
// d'action différente ("warn") : pas de nouveau store. ---

async function warn(client, message, args) {
  if (!can(message.member, "moderation.warn")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const reason = args.slice(1).join(" ") || null;
  const tag = target.user.tag;
  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Avertissement",
    fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
    action: "warn",
    targetId: target.id,
    targetTag: tag,
    moderator: message.author,
    reason,
    channelId: message.channel.id,
  });
  const carteWarn = await carteSanctionMessage({ action: "warn", cible: target, moderateur: message.author, raison: reason, serveur: message.guild.name });
  return repondreAvecCarte(message, carteWarn, () =>
    reply(message, "success", `**${tag}** a été averti.${reason ? `\nRaison : ${reason}` : ""}`)
  );
}

async function warnings(client, message, args) {
  if (!can(message.member, "logs.view")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const entries = historyStore.search(message.guild.id, { targetId: target.id, action: "warn", limit: 15 });
  if (!entries.length) return reply(message, "info", `Aucun avertissement enregistré pour **${target.user.tag}**.`);

  const lines = entries.map((e) => {
    const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
    return `**Case #${e.caseNumber}** — par ${e.moderatorTag || e.moderatorId} — ${when}${e.reason ? ` — ${e.reason}` : ""}`;
  });
  return reply(message, "info", `**Avertissements de ${target.user.tag}** (${entries.length}) :\n${lines.join("\n")}`);
}

async function unwarn(client, message, args) {
  if (!can(message.member, "logs.manage")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const caseNumber = parseInt(args[1], 10);
  if (!Number.isInteger(caseNumber) || caseNumber < 1) {
    return reply(message, "error", "Indique un numéro de case : `unwarn @membre <numéro>` (voir `&warnings`).");
  }

  const entry = historyStore.search(message.guild.id, { targetId: target.id, action: "warn", caseNumber })[0];
  if (!entry) return reply(message, "error", "Aucun avertissement à ce numéro.");

  historyStore.deleteById(message.guild.id, entry.id);
  return reply(message, "success", `**Case #${entry.caseNumber}** (avertissement) supprimée de l'historique de **${target.user.tag}**.`);
}

// --- Fiche détaillée d'une case (&case <numéro>), tous types de sanction confondus ---

async function caseView(client, message, args) {
  if (!can(message.member, "logs.view")) return;
  const caseNumber = parseInt(args[0], 10);
  if (!Number.isInteger(caseNumber) || caseNumber < 1) {
    return reply(message, "error", "Indique un numéro de case : `case <numéro>`.");
  }

  const entry = historyStore.search(message.guild.id, { caseNumber, limit: 1 })[0];
  if (!entry) return reply(message, "error", `Aucune case #${caseNumber} sur ce serveur.`);

  const when = `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:F>`;
  return reply(
    message,
    "info",
    [
      `**Case #${entry.caseNumber}**`,
      `> **Type** : \`${entry.action}\``,
      `> **Cible** : ${entry.targetTag || entry.targetId} (${entry.targetId})`,
      `> **Modérateur** : ${entry.moderatorTag || entry.moderatorId}`,
      `> **Date** : ${when}`,
      `> **Raison** : ${entry.reason || "*aucune*"}`,
    ].join("\n")
  );
}

// --- &tempban / &banlist ---

async function tempban(client, message, args) {
  if (!can(message.member, "moderation.ban")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const targetId = parseTarget(args);
  if (!targetId) return reply(message, "error", "Indique un membre : `tempban @membre <durée> [raison]`.");

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (target) {
    const refusal = checkHierarchy(message.guild, message.member, target);
    if (refusal) return reply(message, "error", refusal);
  }

  const durationMs = parseDuration(args[1]);
  if (!durationMs) return reply(message, "error", "Indique une durée valide : `tempban @membre 1d [raison]`.");
  const reason = args.slice(2).join(" ").trim() || null;

  const tag = target?.user.tag || targetId;
  try {
    await message.guild.members.ban(targetId, { reason: `Tempban par ${message.author.tag}${reason ? ` : ${reason}` : ""} (${formatDuration(durationMs)})` });
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }
  tempBanStore.add(message.guild.id, targetId, Date.now() + durationMs);

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Ban temporaire",
    fields: [{ label: "Cible", value: `${tag} (${targetId})` }, { label: "Durée", value: formatDuration(durationMs) }],
    action: "tempban",
    targetId,
    targetTag: tag,
    moderator: message.author,
    reason,
    channelId: message.channel.id,
  });
  const carteTempban = await carteSanctionMessage({ action: "tempban", cible: target, moderateur: message.author, raison: reason, duree: formatDuration(durationMs), serveur: message.guild.name });
  return repondreAvecCarte(message, carteTempban, () =>
    reply(message, "success", `**${tag}** banni pour ${formatDuration(durationMs)}.`)
  );
}

/** Appelé périodiquement (voir index.js) pour débannir les tempbans arrivés à échéance. */
async function checkExpiredTempbans(client) {
  const expired = tempBanStore.getExpired();
  for (const entry of expired) {
    tempBanStore.remove(entry.guildId, entry.userId);
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;
    await guild.members.unban(entry.userId, "Fin du ban temporaire").catch(() => {});
    await report(client, {
      guildId: entry.guildId,
      category: "moderation",
      title: "Fin du ban temporaire",
      fields: [{ label: "Cible", value: entry.userId }],
      action: "unban",
      targetId: entry.userId,
      targetTag: null,
      moderator: client.user,
      channelId: null,
    }).catch(() => {});
  }
}

async function banlist(client, message) {
  if (!can(message.member, "moderation.unban")) return;
  const bans = await message.guild.bans.fetch().catch(() => null);
  if (!bans) return reply(message, "error", "Impossible de récupérer la liste des bannis.");
  if (!bans.size) return reply(message, "info", "Personne n'est banni.");
  const lines = [...bans.values()].slice(0, 40).map((b) => `\`${b.user.tag}\` (${b.user.id})${b.reason ? ` — ${b.reason}` : ""}`);
  return reply(message, "info", `**${bans.size} membre(s) banni(s)** :\n${lines.join("\n")}`);
}

// --- &hideall / &unhideall ---

async function toggleAllChannels(client, message, { deny }) {
  if (!can(message.member, "channels.manageall")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const everyone = message.guild.roles.everyone;
  const channels = message.guild.channels.cache.filter(
    (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && c.manageable
  );

  let changed = 0;
  for (const channel of channels.values()) {
    const currentlyDenied = channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel);
    if (deny && currentlyDenied) continue;
    if (!deny && !currentlyDenied) continue;
    await channel.permissionOverwrites
      .edit(everyone, { ViewChannel: deny ? false : null }, { reason: `${deny ? "Masquage" : "Affichage"} de masse par ${message.author.tag}` })
      .catch(() => {});
    changed++;
  }

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: deny ? "Masquage de masse" : "Affichage de masse",
    fields: [{ label: "Salons concernés", value: String(changed) }],
    action: deny ? "hideall" : "unhideall",
    targetId: null,
    targetTag: null,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { changed },
  });
  await reply(message, "success", `**${changed}** salon(s) ${deny ? "masqué(s)" : "réaffiché(s)"}.`);
}

const hideall = (client, message) => toggleAllChannels(client, message, { deny: true });
const unhideall = (client, message) => toggleAllChannels(client, message, { deny: false });

// --- &derank ---

async function derank(client, message, args) {
  if (!can(message.member, "members.role")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const refusal = checkHierarchy(message.guild, message.member, target);
  if (refusal) return reply(message, "error", refusal);

  const me = message.guild.members.me;
  const removable = target.roles.cache.filter((r) => r.id !== message.guild.id && r.position < me.roles.highest.position);
  if (!removable.size) return reply(message, "info", `${target.user.tag} n'a aucun rôle que je peux retirer.`);

  try {
    await target.roles.remove(removable, `Derank par ${message.author.tag}`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  await report(client, {
    guildId: message.guild.id,
    category: "members",
    title: "Derank",
    fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }, { label: "Rôles retirés", value: String(removable.size) }],
    action: "derank",
    targetId: target.id,
    targetTag: target.user.tag,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { removed: [...removable.keys()] },
  });
  await reply(message, "success", `**${removable.size}** rôle(s) retiré(s) à **${target.user.tag}**.`);
}

module.exports = {
  muterole,
  setMuteRole,
  mute: (client, message, args) => muteMember(client, message, args, { temporary: false }),
  tempmute: (client, message, args) => muteMember(client, message, args, { temporary: true }),
  unmute: unmuteMember,
  cmute: (client, message, args) => muteMember(client, message, args, { temporary: false }),
  tempcmute: (client, message, args) => muteMember(client, message, args, { temporary: true }),
  uncmute: unmuteMember,
  mutelist,
  unmuteall,
  checkExpiredMutes,
  sanctions,
  baninfo,
  delSanction,
  clearSanctions,
  clearAllSanctions,
  warn,
  warnings,
  unwarn,
  caseView,
  tempban,
  checkExpiredTempbans,
  banlist,
  hideall,
  unhideall,
  derank,
};
