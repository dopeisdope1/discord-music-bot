const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { carteActionMessage, repondreAvecCarte, avatarDe, nomDe } = require("./actionCard");
const { carteTableau } = require("./sectionDashboard");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const roleLimitStore = require("./roleLimitStore");
const accessStore = require("./accessStore");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text, { guildId: message.guild.id })] });

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

  // Pas de checkHierarchy quand la cible est SOI-MÊME ou LE BOT : ces
  // blocages ("Tu/Je ne peux pas agir sur toi/moi-même") visent kick/ban/
  // timeout (une action qui NUIT à la cible), pas ajouter/retirer un rôle —
  // bénin, et déjà couvert par la hiérarchie sur le RÔLE lui-même juste en
  // dessous (donner un rôle au bot au-delà de sa propre position reste
  // impossible de toute façon, Discord le refuserait).
  const ciblePasSoumiseAHierarchie = mentionedMember.id === message.member.id || mentionedMember.id === message.guild.members.me.id;
  const refusal = ciblePasSoumiseAHierarchie ? null : checkHierarchy(message.guild, message.member, mentionedMember);
  if (refusal) return reply(message, "error", refusal);

  // Hiérarchie sur le RÔLE lui-même, distincte de la hiérarchie sur la
  // cible : attribuer un rôle plus haut que le sien reste interdit même
  // si la cible, elle, est en dessous.
  const me = message.guild.members.me;
  if (me.roles.highest.position <= mentionedRole.position) {
    return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
  }
  // Le rang sys donne déjà un accès total à toutes les commandes
  // (utils/permissions/engine.js::can) : la hiérarchie de RÔLE DISCORD ne
  // doit pas le freiner en plus — même correctif que checkHierarchy
  // (utils/moderation/actions.js), pour la même incohérence.
  const contourneHierarchieRole =
    message.member.id === message.guild.ownerId ||
    message.member.permissions.has(PermissionFlagsBits.Administrator) ||
    accessStore.isOwner(message.member.id) ||
    accessStore.isAllowed("sys", message.member.id);
  if (!contourneHierarchieRole && message.member.roles.highest.position <= mentionedRole.position) {
    return reply(message, "error", "Tu ne peux pas gérer un rôle supérieur ou égal au tien.");
  }

  const already = mentionedMember.roles.cache.has(mentionedRole.id);
  if (sub === "add" && already) return reply(message, "info", `${mentionedMember.user.tag} a déjà ce rôle.`);
  if (sub === "remove" && !already) return reply(message, "info", `${mentionedMember.user.tag} n'a pas ce rôle.`);

  // &limitrole : place limitée sur ce rôle (utils/roleLimitStore.js) — un
  // garde-fou côté bot, pas une règle Discord native.
  if (sub === "add") {
    const limite = roleLimitStore.getLimit(message.guild.id, mentionedRole.id);
    if (limite != null && mentionedRole.members.size >= limite) {
      return reply(message, "error", `Le rôle **${mentionedRole.name}** est déjà plein (${limite} membre(s) maximum, voir \`&limitrole\`).`);
    }
  }

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
  // Carte d'action en image (utils/actionCard.js). Si le rendu échoue, on
  // retombe sur le message texte : l'attribution a DÉJÀ eu lieu, ne rien
  // répondre laisserait croire qu'elle a échoué.
  const carte = await carteActionMessage(
    {
      titre: sub === "add" ? "Rôle ajouté" : "Rôle retiré",
      couleur: sub === "add" ? "#4ade80" : "#ff6b6b",
      membre: { nom: nomDe(mentionedMember), sousTitre: mentionedMember.id, avatarURL: avatarDe(mentionedMember) },
      lignes: [
        // La pastille reprend la couleur RÉELLE du rôle ; un rôle sans
        // couleur vaut 0 chez Discord, ce qui donnerait un point noir
        // invisible sur fond sombre.
        { label: "Rôle", valeur: mentionedRole.name, couleur: mentionedRole.color ? `#${mentionedRole.color.toString(16).padStart(6, "0")}` : "#8b849f" },
        { label: "Par", valeur: message.author.tag },
      ],
      pied: message.guild.name,
    },
    "role.png"
  );
  return repondreAvecCarte(message, carte, () =>
    reply(message, "success", `Rôle **${mentionedRole.name}** ${sub === "add" ? "ajouté à" : "retiré de"} **${mentionedMember.user.tag}**.`)
  );
}

const handlers = {
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
    // Fiche dessinée (même moteur que les rubriques du panel et les cartes de
    // sanction) ; le message d'origine reste le repli si le rendu ou l'envoi
    // échoue — voir utils/actionCard.js::repondreAvecCarte.
    const corps = lines.join("\n");
    await repondreAvecCarte(
      message,
      carteTableau(corps, {
        titre: "Informations membre",
        sousTitre: nomDe(mentioned),
        couleur: "#38bdf8",
        guild: message.guild,
        nomFichier: "userinfo.png",
      }),
      () =>
        message.reply({
          embeds: [buildStatusEmbed("info", corps, { title: "Informations membre", thumbnail: mentioned.user.displayAvatarURL(), guildId: message.guild.id })],
        })
    );
  },
};


module.exports = {
  ...handlers,
  formatDuration,
  parseDuration,
};
