const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const { formatDuration, parseDuration } = require("./sanctionsCommands");
const historyStore = require("./moderationHistoryStore");
const muteStore = require("./muteStore");
const gradeMuteStore = require("./gradeMuteStore");
const tempBanStore = require("./tempBanStore");
const listNavigator = require("./listNavigator");

// `{ embeds: [...] }` et non l'EmbedBuilder nu : discord.js étalerait ce dernier en
// `{ data }`, sans `content` ni `embeds` — un message VIDE, refusé par Discord.
const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text, { guildId: message.guild.id })] });

/** Cible = PREMIER argument exactement (mention ou ID) — jamais "une mention trouvée n'importe où". */
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

// --- Rôle de mute (-muterole, -set muterole) ---

async function muterole(client, message) {
  if (!can(message.member, "protection.automod")) return;
  const roleId = muteStore.getMuteRoleId(message.guild.id);
  if (!roleId || !message.guild.roles.cache.has(roleId)) {
    return reply(message, "info", "Aucun rôle de mute configuré. Utilise `set muterole @rôle`.");
  }
  return reply(message, "info", `Rôle de mute configuré : <@&${roleId}>.`);
}

/** Appelée par le dispatcher -set pour la sous-commande "muterole". */
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

// --- &permmute / &permunmute (rôle de mute, SANS échéance) ---
//
// Distinct de &mute (utils/sanctionsCommands.js), qui est le timeout NATIF
// Discord : plafonné à 28 jours par Discord, rien à configurer. &permmute
// existe pour la seule chose que le timeout natif ne sait pas faire — un mute
// sans aucune échéance, levé uniquement à la main. Exige `set muterole`.
// (L'ancien &tempmute, plafonné lui aussi à 28 jours, faisait doublon avec
// &mute <durée> et a été retiré ; &cmute/&tempcmute/&uncmute n'étaient que
// des alias exacts de ces commandes, sans aucune restriction au texte.)

async function muteMember(client, message, args) {
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

  const reason = args.slice(1).join(" ").trim() || null;

  if (target.roles.cache.has(role.id)) return reply(message, "info", `${target.user.tag} est déjà mute (rôle de mute).`);

  try {
    await target.roles.add(role, `Mute illimité par ${message.author.tag}${reason ? ` : ${reason}` : ""}`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }

  // Historique : action "mute" conservée (même nom qu'avant le renommage en
  // &permmute) pour que les anciennes entrées et les nouvelles se lisent pareil.
  await report(client, {
    guildId: message.guild.id,
    title: "Mute illimité (rôle de mute)",
    fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
    action: "mute",
    targetId: target.id,
    targetTag: target.user.tag,
    moderator: message.author,
    reason,
    channelId: message.channel.id,
  });

  await reply(message, "success", `**${target.user.tag}** mute sans échéance (rôle de mute) — \`permunmute\` pour lever.`);
}

async function unmuteMember(client, message, args) {
  if (!can(message.member, "moderation.timeout")) return;
  const role = await requireMuteRole(message);
  if (!role) return;

  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  if (!target.roles.cache.has(role.id)) return reply(message, "info", `${target.user.tag} n'a pas le rôle de mute (pour un timeout : \`unmute\`).`);

  // Mute posé par &bmute : même rôle, mais verrouillé à un grade. Le lever
  // ici contournerait ce verrou (et laisserait l'entrée orpheline dans
  // gradeMuteStore) — seul &bunmute vérifie le grade.
  if (gradeMuteStore.getMute(message.guild.id, target.id)) {
    return reply(message, "error", `${target.user.tag} est mute par \`bmute\` (verrouillé au grade) — utilise \`bunmute @membre\`.`);
  }

  try {
    await target.roles.remove(role, `Démute par ${message.author.tag}`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }
  muteStore.removeTempMute(message.guild.id, target.id);

  await report(client, {
    guildId: message.guild.id,
    title: "Démute (rôle de mute retiré)",
    fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
    action: "unmute",
    targetId: target.id,
    targetTag: target.user.tag,
    moderator: message.author,
    channelId: message.channel.id,
  });
  await reply(message, "success", `**${target.user.tag}** n'est plus mute.`);
}

// "tempmute" : entrées d'historique antérieures au retrait de &tempmute.
const ROLE_MUTE_ACTIONS = new Set(["mute", "tempmute"]);

/** Dernière entrée d'historique d'une des `actions` données pour ce membre. */
function dernierePlus(guildId, targetId, actions) {
  return historyStore.search(guildId, { targetId, limit: 25 }).find((e) => actions.has(e.action)) || null;
}

const ilYA = (iso) => `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;

async function mutelist(client, message) {
  if (!can(message.member, "moderation.timeout")) return;
  return listNavigator.repondreAvecListe("mutelist", message);
}

listNavigator.registerProvider("mutelist", (guild) => {
  const guildId = guild.id;
  const roleId = muteStore.getMuteRoleId(guildId);
  const role = roleId ? guild.roles.cache.get(roleId) : null;
  const tempMutes = muteStore.getTempMutesForGuild(guildId);

  const lignesMute = role
    ? [...role.members.values()].map((m) => {
        const entree = dernierePlus(guildId, m.id, ROLE_MUTE_ACTIONS);
        const temp = tempMutes.find((t) => t.userId === m.id);
        const echeance = temp ? `expire <t:${Math.floor(temp.expiresAt / 1000)}:R>` : "aucune échéance (démute manuel)";
        const qui = entree ? `par ${entree.moderatorTag || `<@${entree.moderatorId}>`} — ${ilYA(entree.createdAt)}` : "origine inconnue";
        return `<@${m.id}> — ${qui} — ${echeance}`;
      })
    : [];

  const membresTimeout = guild.members.cache.filter(
    (m) => m.communicationDisabledUntil && new Date(m.communicationDisabledUntil).getTime() > Date.now()
  );
  const lignesTimeout = [...membresTimeout.values()].map((m) => {
    const entree = dernierePlus(guildId, m.id, new Set(["timeout"]));
    const qui = entree ? `par ${entree.moderatorTag || `<@${entree.moderatorId}>`} — ${ilYA(entree.createdAt)}` : "origine inconnue";
    return `<@${m.id}> — ${qui} — expire <t:${Math.floor(new Date(m.communicationDisabledUntil).getTime() / 1000)}:R>`;
  });

  return {
    title: "Mutes actifs",
    compteur: `**${lignesMute.length + lignesTimeout.length}** fiche(s) active(s)`,
    lines: [
      `**Mute illimité — rôle de mute** (${lignesMute.length})`,
      ...(lignesMute.length ? lignesMute : [role ? "*Personne n'est mute actuellement.*" : "*Aucun rôle de mute configuré.*"]),
      `**Mute — timeout Discord** (${lignesTimeout.length})`,
      ...(lignesTimeout.length ? lignesTimeout : ["*Aucun timeout en cours.*"]),
    ],
  };
});

/**
 * &unmuteall — lève TOUS les mutes du serveur : le rôle de mute (&permmute)
 * ET les timeouts natifs en cours (&mute). Le rôle de mute n'est requis que
 * pour la première partie : sans rôle configuré, les timeouts sont quand même
 * levés.
 *
 * Les mutes posés par &bmute (même rôle, verrouillé à un grade) sont
 * volontairement ÉPARGNÉS : ils ne se lèvent que par &bunmute, qui vérifie le
 * grade. Les inclure ici contournerait ce verrou et laisserait leurs entrées
 * orphelines dans gradeMuteStore.
 */
async function unmuteall(client, message) {
  if (!can(message.member, "moderation.unmuteall")) return;

  const roleId = muteStore.getMuteRoleId(message.guild.id);
  const role = roleId ? message.guild.roles.cache.get(roleId) : null;
  const echecs = [];

  let roleCount = 0;
  let gradesEpargnes = 0;
  if (role) {
    for (const m of role.members.values()) {
      if (gradeMuteStore.getMute(message.guild.id, m.id)) {
        gradesEpargnes++;
        continue;
      }
      try {
        await m.roles.remove(role, `Démute de masse par ${message.author.tag}`);
        roleCount++;
      } catch (err) {
        echecs.push(`${m.user?.tag || m.id} (${err.message})`);
      }
    }
    muteStore.clearTempMutes(message.guild.id);
  }

  let timeoutCount = 0;
  const enTimeout = message.guild.members.cache.filter(
    (m) => m.communicationDisabledUntil && new Date(m.communicationDisabledUntil).getTime() > Date.now()
  );
  for (const m of enTimeout.values()) {
    try {
      await m.timeout(null, `Démute de masse par ${message.author.tag}`);
      timeoutCount++;
    } catch (err) {
      echecs.push(`${m.user?.tag || m.id} (${err.message})`);
    }
  }

  if (echecs.length) {
    console.error(`[unmuteall] ${echecs.length} echec(s) : ${echecs.join(", ")}`);
  }
  const count = roleCount + timeoutCount;

  await report(client, {
    guildId: message.guild.id,
    title: "Démute de masse",
    fields: [
      { label: "Rôle de mute retiré", value: String(roleCount) },
      { label: "Timeouts levés", value: String(timeoutCount) },
      ...(gradesEpargnes ? [{ label: "Mutes bot (bmute) épargnés", value: String(gradesEpargnes) }] : []),
    ],
    action: "unmuteall",
    targetId: null,
    targetTag: null,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { count, roleCount, timeoutCount, gradesEpargnes },
  });
  const epargnes = gradesEpargnes
    ? `\n${gradesEpargnes} mute(s) \`bmute\` laissé(s) en place (verrouillés au grade) — \`bunmute @membre\` pour les lever.`
    : "";
  await reply(message, "success", `**${count}** membre(s) démute (${roleCount} rôle de mute, ${timeoutCount} timeout).${epargnes}`);
}

/**
 * Appelé périodiquement (voir index.js) pour lever les mutes temporaires à
 * rôle arrivés à échéance. &tempmute n'existe plus, mais des entrées posées
 * avant son retrait peuvent encore être en attente dans muteStore : elles
 * doivent continuer d'expirer normalement.
 */
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
    try {
      await member.roles.remove(role, "Fin du mute temporaire");
    } catch (err) {
      console.error(`[tempmute] fin de mute impossible pour ${member.id} : ${err.message}`);
      continue;
    }
    await report(client, {
      guildId: entry.guildId,
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

// --- Sanctions (&sanctions, &del sanction, &reset sanctions, &reset all sanctions) ---

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
 * -baninfo <@membre|id> — détail du DERNIER bannissement enregistré pour cet
 * identifiant.
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

  const caseNumber = parseInt(args[1], 10);
  if (!Number.isInteger(caseNumber) || caseNumber < 1) return reply(message, "error", "Indique un numéro : `del sanction @membre <nombre>` (voir `-sanctions`).");

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

// --- Avertissements (-warn, -warnings, -unwarn) ---

async function warn(client, message, args) {
  if (!can(message.member, "moderation.warn")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const reason = args.slice(1).join(" ") || null;
  const tag = target.user.tag;
  await report(client, {
    guildId: message.guild.id,
    title: "Avertissement",
    fields: [{ label: "Cible", value: `<@${target.id}> (${target.id})` }],
    action: "warn",
    targetId: target.id,
    targetTag: tag,
    moderator: message.author,
    reason,
    channelId: message.channel.id,
  });
  await reply(message, "success", `**${tag}** a été averti.${reason ? `\nRaison : ${reason}` : ""}`);
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
    return reply(message, "error", "Indique un numéro de case : `unwarn @membre <numéro>` (voir `-warnings`).");
  }

  const entry = historyStore.search(message.guild.id, { targetId: target.id, action: "warn", caseNumber })[0];
  if (!entry) return reply(message, "error", "Aucun avertissement à ce numéro.");

  historyStore.deleteById(message.guild.id, entry.id);
  return reply(message, "success", `**Case #${entry.caseNumber}** (avertissement) supprimée de l'historique de **${target.user.tag}**.`);
}

// --- Fiche détaillée d'une case (-case <numéro>), tous types de sanction confondus ---

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

// --- -tempban / -banlist ---

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
    title: "Ban temporaire",
    fields: [{ label: "Cible", value: `${tag} (${targetId})` }, { label: "Durée", value: formatDuration(durationMs) }],
    action: "tempban",
    targetId,
    targetTag: tag,
    moderator: message.author,
    reason,
    channelId: message.channel.id,
  });
  await reply(message, "success", `**${tag}** banni pour ${formatDuration(durationMs)}.`);
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
  return listNavigator.repondreAvecListe("banlist", message);
}

listNavigator.registerProvider("banlist", async (guild) => {
  const bans = await guild.bans.fetch().catch(() => null);
  if (!bans) return { title: "Membres bannis", erreur: "Impossible de récupérer la liste des bannis." };
  return {
    title: "Membres bannis",
    vide: "Personne n'est banni.",
    numerote: true,
    lines: [...bans.values()].map((b) => `\`${b.user.tag}\` (${b.user.id})${b.reason ? ` — ${b.reason}` : ""}`),
  };
});

// --- -hideall / -unhideall ---

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

// --- -derank ---

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
  permmute: muteMember,
  permunmute: unmuteMember,
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
