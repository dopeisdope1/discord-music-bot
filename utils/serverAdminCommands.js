const {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const accessStore = require("./accessStore");
const automod = require("./automod/antiSpam");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const deroStore = require("./deroStore");
const voiceChannels = require("./voiceChannels");
const { checkBotPermission, report } = require("./moderation/actions");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

// Rendu des cartes (générique + listes paginées) : utils/listCard.js, partagé
// avec les listes en lecture seule d'utils/utilityCommands.js.
const { ID, card, buildListCard } = require("./listCard");
const readOnlyLists = require("./readOnlyLists");

/** &owners — gestion du rang sys, vue dédiée et paginée (voir aussi &panel > Rang sys). */
async function owners(client, message) {
  const isSys = accessStore.isAllowed("sys", message.author.id);
  const isOwner = accessStore.isOwner(message.author.id);
  if (!isSys && !isOwner) return;

  const items = accessStore.list("sys").map((id) => `<@${id}> (${id})`);
  await message.reply(
    buildListCard({
      idKind: "owners",
      title: "Liste des owners (rang sys)",
      description: "Le rang sys donne accès à tout le bot. Seul le propriétaire du bot peut ajouter ou retirer.",
      items,
      page: 0,
      canEdit: isOwner,
    })
  );
}

/** &whitelist — exemptés de l'anti-spam (voir aussi &panel > Protection). */
async function whitelist(client, message) {
  if (!can(message.member, "protection.whitelist")) return;
  const items = automod.getWhitelist(message.guild.id).users.map((id) => `<@${id}> (${id})`);
  await message.reply(
    buildListCard({
      idKind: "whitelist",
      title: "Liste WL (anti-spam)",
      description: "Ces membres sont exemptés de l'anti-spam/anti-flood.",
      items,
      page: 0,
      canEdit: true,
    })
  );
}

/**
 * &allbots — lecture seule, réservée au rang sys (comme &sources). Le contenu
 * vient d'utils/readOnlyLists.js, exactement comme la pagination de la carte :
 * une seule définition, impossible que les deux se contredisent.
 */
async function allbots(client, message, args) {
  if (!can(message.member, "sys")) return;
  await readOnlyLists.ensureMembersCached(message.guild);
  const { title, description, items } = readOnlyLists.DEFINITIONS.bots.build(message.guild);
  const page = parseInt(args[0], 10) - 1 || 0;
  await message.reply(buildListCard({ idKind: "bots", title, description, items, page, canEdit: false }));
}

/** Traite les interactions du panneau générique liste paginée (customId "srv:page|add|del:..."). */
async function handleServerAdminInteraction(interaction) {
  const [, action, idKind] = interaction.customId.split(":");

  const LISTS = {
    owners: {
      permission: () => accessStore.isAllowed("sys", interaction.user.id) || accessStore.isOwner(interaction.user.id),
      canEdit: () => accessStore.isOwner(interaction.user.id),
      title: "Liste des owners (rang sys)",
      description: "Le rang sys donne accès à tout le bot. Seul le propriétaire du bot peut ajouter ou retirer.",
      items: () => accessStore.list("sys").map((id) => `<@${id}> (${id})`),
      add: (userId) => accessStore.add("sys", userId),
      del: (userId) => accessStore.remove("sys", userId),
    },
    whitelist: {
      permission: () => can(interaction.member, "protection.whitelist"),
      canEdit: () => true,
      title: "Liste WL (anti-spam)",
      description: "Ces membres sont exemptés de l'anti-spam/anti-flood.",
      items: () => automod.getWhitelist(interaction.guild.id).users.map((id) => `<@${id}> (${id})`),
      add: (userId) => automod.addToWhitelist(interaction.guild.id, "users", userId),
      del: (userId) => automod.removeFromWhitelist(interaction.guild.id, "users", userId),
    },
  };

  // Les listes en LECTURE SEULE (bots, admins, boosters, membres d'un rôle —
  // voir utils/readOnlyLists.js) n'ont ni ajout ni retrait, mais elles
  // doivent bien changer de page : sans ce branchement, leur sélecteur de
  // page restait décoratif et le clic ne faisait rien.
  const [readOnlyKind, readOnlyArg] = idKind.split("/");
  const readOnly = readOnlyLists.DEFINITIONS[readOnlyKind];
  if (readOnly) {
    if (action !== "page") return;
    if (readOnly.permission && !readOnly.permission(interaction.member)) {
      return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    }
    // Le cache peut être froid ici (redémarrage du bot depuis l'envoi de la
    // carte) : sans ça, la page 2 d'une vieille carte serait tronquée.
    await readOnlyLists.ensureMembersCached(interaction.guild);
    const built = readOnly.build(interaction.guild, readOnlyArg);
    if (!built) return interaction.reply({ content: "Cette liste n'existe plus.", flags: MessageFlags.Ephemeral });
    return interaction.update(
      buildListCard({ idKind, title: built.title, description: built.description, items: built.items, page: parseInt(interaction.values[0], 10) || 0, canEdit: false })
    );
  }

  const list = LISTS[idKind];
  if (!list) return;
  if (!list.permission()) {
    return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
  }

  let page = 0;
  if (action === "page") {
    page = parseInt(interaction.values[0], 10) || 0;
  } else if (action === "add" || action === "del") {
    if (!list.canEdit()) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (accessStore.isOwner(userId) && idKind === "owners") {
      return interaction.reply({ content: `<@${userId}> est propriétaire du bot, déjà tous les accès.`, flags: MessageFlags.Ephemeral });
    }
    const changed = action === "add" ? list.add(userId) : list.del(userId);
    if (!changed) {
      return interaction.reply({
        content: action === "add" ? `<@${userId}> y était déjà.` : `<@${userId}> n'y était pas.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  return interaction.update(
    buildListCard({ idKind, title: list.title, description: list.description, items: list.items(), page, canEdit: list.canEdit() })
  );
}

// --- &role create/delete/rename/color/admin (gestion du rôle lui-même,
// distinct de &addrole/&delrole qui gèrent l'appartenance d'un membre — voir
// utils/moderationCommands.js) ---

const ROLE_ADMIN_SUBCOMMANDS = new Set(["create", "delete", "rename", "color", "admin"]);

function botCanManageRole(guild, role) {
  return guild.members.me.roles.highest.position > role.position;
}

// Confirmation générique pour une action destructrice/sensible (suppression
// de rôle ou de salon, don d'Administrateur) : un clic ne suffit jamais.
// `execute` n'est rappelé qu'après confirmation ET revérification des
// droits — la situation a pu changer pendant que le panneau attendait.
const pendingConfirms = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function rememberConfirm(data) {
  const now = Date.now();
  for (const [key, value] of pendingConfirms) {
    if (now - value.at > PENDING_TTL_MS) pendingConfirms.delete(key);
  }
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  pendingConfirms.set(token, { ...data, at: now });
  return token;
}

function requestConfirmation(message, { title, body, confirmLabel, permission, execute }) {
  const token = rememberConfirm({ actorId: message.author.id, permission, execute });
  return message.reply(
    card(title, body, [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:confirm:go:${token}`).setLabel(confirmLabel).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${ID}:confirm:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
      ),
    ])
  );
}

async function handleConfirmInteraction(interaction) {
  const [, , action, token] = interaction.customId.split(":"); // srv:confirm:go|no:TOKEN
  const pending = pendingConfirms.get(token);
  if (!pending) return interaction.update(card("Expiré", "Relance la commande pour recommencer."));
  if (interaction.user.id !== pending.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }
  pendingConfirms.delete(token);

  if (action === "no") return interaction.update(card("Annulé", null));

  if (!can(interaction.member, pending.permission)) {
    return interaction.update(card("Accès refusé", "Tu n'as plus ce droit."));
  }
  await pending.execute(interaction);
}

async function roleAdmin(client, message, args) {
  const sub = args[0].toLowerCase();
  // Mention OU ID pour le rôle (règle du cahier des charges) : les IDs
  // bruts après le mot de sous-commande sont résolus en cache si aucune
  // mention n'a été donnée.
  const roleIdArg = args.slice(1).find((a) => /^\d{15,25}$/.test(a));
  const role = message.mentions.roles?.first() || (roleIdArg ? message.guild.roles.cache.get(roleIdArg) : null);

  if (sub === "create") {
    if (!can(message.member, "server.roles.manage")) return;
    const name = args.slice(1).join(" ").trim();
    if (!name) return reply(message, "error", "Indique un nom : `role create <nom>`.");
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    let created;
    try {
      created = await message.guild.roles.create({ name, reason: `Rôle créé par ${message.author.tag}` });
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Rôle créé",
      fields: [{ label: "Rôle", value: `${created.name} (${created.id})` }],
      action: "role_create",
      targetId: created.id,
      targetTag: created.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Rôle **${created.name}** créé.`);
  }

  if (!role) return reply(message, "error", `Indique un rôle : \`role ${sub} @rôle ...\`.`);

  if (sub === "delete") {
    if (!can(message.member, "server.roles.manage")) return;
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const roleId = role.id;
    const name = role.name;
    return requestConfirmation(message, {
      title: "Confirmer la suppression du rôle",
      body: `Rôle : **${name}** (${roleId})\n\nCette action est irréversible.`,
      confirmLabel: "Supprimer",
      permission: "server.roles.manage",
      execute: async (interaction) => {
        const fresh = interaction.guild.roles.cache.get(roleId);
        if (!fresh) return interaction.update(card("Rôle introuvable", "Ce rôle n'existe déjà plus."));
        try {
          await fresh.delete(`Rôle supprimé par ${interaction.user.tag}`);
        } catch (err) {
          return interaction.update(card("Action impossible", `Discord a refusé : ${err.message}`));
        }
        await report(interaction.client, {
          guildId: interaction.guild.id,
          category: "server",
          title: "Rôle supprimé",
          fields: [{ label: "Rôle", value: `${name} (${roleId})` }],
          action: "role_delete",
          targetId: roleId,
          targetTag: name,
          moderator: interaction.user,
          channelId: interaction.channelId,
        });
        return interaction.update(card("Terminé", `Rôle **${name}** supprimé.`));
      },
    });
  }

  if (sub === "rename") {
    if (!can(message.member, "server.roles.manage")) return;
    const newName = args.slice(2).join(" ").trim();
    if (!newName) return reply(message, "error", "Indique le nouveau nom : `role rename @rôle <nom>`.");
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const oldName = role.name;
    try {
      await role.setName(newName, `Renommé par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Rôle mis à jour",
      fields: [{ label: "Rôle", value: `${newName} (${role.id})` }, { label: "Nom", value: `${oldName} → ${newName}` }],
      action: "role_rename",
      targetId: role.id,
      targetTag: newName,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Rôle renommé **${oldName}** → **${newName}**.`);
  }

  if (sub === "color") {
    if (!can(message.member, "server.roles.manage")) return;
    const hex = args[2];
    if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return reply(message, "error", "Indique une couleur hexadécimale : `role color @rôle #ff0000`.");
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const color = hex.startsWith("#") ? hex : `#${hex}`;
    try {
      await role.setColor(color, `Couleur changée par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Rôle mis à jour",
      fields: [{ label: "Rôle", value: `${role.name} (${role.id})` }, { label: "Couleur", value: color }],
      action: "role_color",
      targetId: role.id,
      targetTag: role.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Couleur de **${role.name}** réglée sur **${color}**.`);
  }

  if (sub === "admin") {
    // Réservé au rang sys/propriétaire, jamais délégable par rôle (voir
    // "roleGrantable: false" dans utils/permissions/catalog.js) : c'est la
    // commande la plus sensible du bot, confirmation obligatoire.
    if (!can(message.member, "server.roles.admin_grant")) return;
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const roleId = role.id;
    const name = role.name;
    const grant = !role.permissions.has(PermissionFlagsBits.Administrator);
    return requestConfirmation(message, {
      title: `Confirmer : ${grant ? "donner" : "retirer"} Administrateur`,
      body: [
        `Rôle : **${name}** (${roleId})`,
        "",
        grant
          ? "**Administrateur donne un accès total au serveur** à quiconque a ce rôle. Confirme que c'est voulu."
          : "Ce rôle a actuellement la permission Administrateur — la lui retirer ?",
      ].join("\n"),
      confirmLabel: grant ? "Donner Administrateur" : "Retirer",
      permission: "server.roles.admin_grant",
      execute: async (interaction) => {
        const fresh = interaction.guild.roles.cache.get(roleId);
        if (!fresh) return interaction.update(card("Rôle introuvable", "Ce rôle n'existe plus."));
        try {
          const next = grant ? fresh.permissions.add(PermissionFlagsBits.Administrator) : fresh.permissions.remove(PermissionFlagsBits.Administrator);
          await fresh.setPermissions(next, `${grant ? "Administrateur donné" : "Administrateur retiré"} par ${interaction.user.tag}`);
        } catch (err) {
          return interaction.update(card("Action impossible", `Discord a refusé : ${err.message}`));
        }
        await report(interaction.client, {
          guildId: interaction.guild.id,
          category: "server",
          title: grant ? "Administrateur donné à un rôle" : "Administrateur retiré d'un rôle",
          fields: [{ label: "Rôle", value: `${name} (${roleId})` }],
          action: grant ? "role_admin_grant" : "role_admin_revoke",
          targetId: roleId,
          targetTag: name,
          moderator: interaction.user,
          channelId: interaction.channelId,
        });
        return interaction.update(card("Terminé", `Administrateur ${grant ? "donné à" : "retiré de"} **${name}**.`));
      },
    });
  }
}

// --- &channel create/delete/rename/topic ---

async function channelAdmin(client, message, args) {
  if (!can(message.member, "server.channels.manage")) return;
  const sub = (args[0] || "").toLowerCase();
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
  if (botPerm) return reply(message, "error", botPerm);

  if (sub === "create") {
    const isVoice = args[1]?.toLowerCase() === "vocal";
    const name = args.slice(isVoice ? 2 : 1).join(" ").trim();
    if (!name) return reply(message, "error", "Indique un nom : `channel create <nom> [vocal]`.");
    let created;
    try {
      created = await message.guild.channels.create({
        name,
        type: isVoice ? ChannelType.GuildVoice : ChannelType.GuildText,
        reason: `Salon créé par ${message.author.tag}`,
      });
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Salon créé",
      fields: [{ label: "Salon", value: `<#${created.id}> (${created.id})` }],
      action: "channel_create",
      targetId: created.id,
      targetTag: created.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Salon **${created.name}** créé.`);
  }

  // Mention, ID, ou salon courant par défaut (règle du cahier des charges :
  // mention ou ID pour les paramètres de salon).
  const channelIdArg = args.slice(1).find((a) => /^\d{15,25}$/.test(a));
  const target = message.mentions.channels?.first() || (channelIdArg && message.guild.channels.cache.get(channelIdArg)) || message.channel;

  if (sub === "delete") {
    const name = target.name;
    const id = target.id;
    return requestConfirmation(message, {
      title: "Confirmer la suppression du salon",
      body: `Salon : **${name}** (${id})\n\nCette action est irréversible — l'historique part avec.`,
      confirmLabel: "Supprimer",
      permission: "server.channels.manage",
      execute: async (interaction) => {
        const fresh = interaction.guild.channels.cache.get(id);
        if (!fresh) return interaction.update(card("Salon introuvable", "Ce salon n'existe déjà plus."));
        try {
          await fresh.delete(`Salon supprimé par ${interaction.user.tag}`);
        } catch (err) {
          return interaction.update(card("Action impossible", `Discord a refusé : ${err.message}`));
        }
        await report(interaction.client, {
          guildId: interaction.guild.id,
          category: "server",
          title: "Salon supprimé",
          fields: [{ label: "Salon", value: `${name} (${id})` }],
          action: "channel_delete",
          targetId: id,
          targetTag: name,
          moderator: interaction.user,
          channelId: interaction.channelId === id ? null : interaction.channelId,
        });
        // Le salon qui portait la confirmation peut avoir disparu avec la
        // suppression (si on a confirmé depuis le salon ciblé lui-même).
        return interaction.update(card("Terminé", `Salon **${name}** supprimé.`)).catch(() => {});
      },
    });
  }

  if (sub === "rename") {
    const rest = args.filter((a) => !a.startsWith("<#") && a !== channelIdArg).slice(1);
    const newName = rest.join(" ").trim();
    if (!newName) return reply(message, "error", "Indique le nouveau nom : `channel rename [#salon|id] <nom>`.");
    const oldName = target.name;
    try {
      await target.setName(newName, `Renommé par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Salon mis à jour",
      fields: [{ label: "Salon", value: `<#${target.id}> (${target.id})` }, { label: "Nom", value: `${oldName} → ${newName}` }],
      action: "channel_rename",
      targetId: target.id,
      targetTag: newName,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Salon renommé **${oldName}** → **${newName}**.`);
  }

  if (sub === "topic") {
    if (!("setTopic" in target)) return reply(message, "error", "Ce type de salon n'a pas de topic.");
    const rest = args.filter((a) => !a.startsWith("<#") && a !== channelIdArg).slice(1);
    const topic = rest.join(" ").trim();
    try {
      await target.setTopic(topic || null, `Topic changé par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Salon mis à jour",
      fields: [{ label: "Salon", value: `<#${target.id}> (${target.id})` }, { label: "Topic", value: topic || "*retiré*" }],
      action: "channel_topic",
      targetId: target.id,
      targetTag: target.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Topic de <#${target.id}> mis à jour.`);
  }

  return reply(message, "error", "Utilise `channel create|delete|rename|topic ...`.");
}

// --- &dero : permissions automatiques sur chaque nouveau salon ---

async function dero(client, message, args) {
  if (!can(message.member, "server.dero.manage")) return;
  const sub = (args[0] || "").toLowerCase();
  const guildId = message.guild.id;

  if (sub === "off") {
    for (const roleId of deroStore.getRoles(guildId)) deroStore.removeRole(guildId, roleId);
    return reply(message, "success", "Dero automatique désactivé.");
  }

  if (sub === "role") {
    const role = message.mentions.roles?.first();
    if (!role) return reply(message, "error", "Indique un rôle : `dero role @rôle`.");
    const removed = deroStore.removeRole(guildId, role.id);
    if (!removed) deroStore.addRole(guildId, role.id);
    return reply(message, "success", removed ? `**${role.name}** retiré du dero automatique.` : `**${role.name}** ajouté au dero automatique.`);
  }

  const roles = deroStore.getRoles(guildId);
  const lines = roles.length ? roles.map((id) => `<@&${id}>`).join(", ") : "*aucun*";
  await message.reply({
    embeds: [
      buildStatusEmbed(
        "info",
        [
          `> **Rôles** : ${lines}`,
          "> Applique Voir le salon/Envoyer des messages/Se connecter à chaque nouveau salon créé.",
          "",
          "`dero role @rôle` pour ajouter/retirer, `dero off` pour tout désactiver.",
        ].join("\n"),
        { title: "Dero automatique" }
      ),
    ],
  });
}

/** À appeler dans l'écouteur "channelCreate" du client (voir index.js). */
async function applyDeroToNewChannel(channel) {
  if (!channel.guild || !channel.permissionOverwrites) return;
  const roles = deroStore.getRoles(channel.guild.id);
  if (!roles.length) return;
  for (const roleId of roles) {
    const role = channel.guild.roles.cache.get(roleId);
    if (!role) continue;
    await channel.permissionOverwrites
      .edit(role, { ViewChannel: true, SendMessages: true, Connect: true }, { reason: "Dero automatique" })
      .catch((err) => console.error("[dero] échec sur", channel.id, err.message));
  }
}

// --- &antinuke : statut, marche/arrêt, sanction, whitelist par rôle (la
// whitelist par utilisateur vit dans &panel > Anti-nuke, un UserSelectMenu
// suffit là où un rôle a besoin d'un RoleSelectMenu à part). ---

async function antinuke(client, message, args) {
  if (!can(message.member, "protection.guard.manage")) return;
  const sub = (args[0] || "").toLowerCase();
  const guildId = message.guild.id;

  if (sub === "on" || sub === "off") {
    guardConfig.setEnabled(guildId, sub === "on");
    return reply(message, "success", `Anti-nuke ${sub === "on" ? "activé" : "désactivé"}.`);
  }

  if (sub === "punishment") {
    const value = (args[1] || "").toLowerCase();
    if (!guardConfig.setPunishment(guildId, value)) {
      return reply(message, "error", "Sanction invalide. Utilise : `timeout`, `kick` ou `ban`.");
    }
    return reply(message, "success", `Sanction de l'anti-nuke réglée sur **${value}**.`);
  }

  if (sub === "wlrole") {
    const role = message.mentions.roles?.first();
    if (!role) return reply(message, "error", "Indique un rôle : `antinuke wlrole @rôle`.");
    const removed = guardWhitelist.remove(guildId, "roles", role.id);
    if (!removed) guardWhitelist.add(guildId, "roles", role.id);
    return reply(
      message,
      "success",
      removed ? `**${role.name}** retiré de la whitelist anti-nuke.` : `**${role.name}** ajouté à la whitelist anti-nuke.`
    );
  }

  const config = guardConfig.getConfig(guildId);
  await message.reply({
    embeds: [
      buildStatusEmbed(
        "info",
        [
          `> **Statut** : ${config.enabled ? "activé" : "désactivé"}`,
          `> **Sanction** : ${config.punishment}`,
          "",
          "`antinuke on|off` — activer/désactiver",
          "`antinuke punishment timeout|kick|ban` — changer la sanction",
          "`antinuke wlrole @rôle` — exempter/retirer un rôle",
          "",
          "Whitelist par utilisateur, liste des guards et leurs seuils : `&panel` > Anti-nuke.",
        ].join("\n"),
        { title: "Anti-nuke" }
      ),
    ],
  });
}

// --- Salons vocaux temporaires (&voicehub, &voc) ---

async function voicehub(client, message, args) {
  if (!can(message.member, "server.voice.manage")) return;
  const channel = message.mentions.channels?.first();
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    if ((args[0] || "").toLowerCase() === "off") {
      voiceChannels.setHub(message.guild.id, null);
      return reply(message, "success", "Salon générateur désactivé.");
    }
    return reply(message, "error", "Indique un salon vocal : `voicehub #salon-vocal`, ou `voicehub off`.");
  }
  voiceChannels.setHub(message.guild.id, channel.id);
  return reply(message, "success", `Rejoindre <#${channel.id}> crée désormais un salon vocal personnel.`);
}

/**
 * Vrai si `member` est le propriétaire ACTUEL du salon temporaire —
 * strictement, sans exception pour owner/sys (demande explicite : le rang
 * owner/sys passait outre et pouvait gérer n'importe quel salon temporaire
 * sans en être le créateur, via le panneau ET &voc — plus de bypass du tout).
 */
function canManageVoiceChannel(member, channel) {
  const info = voiceChannels.getChannelInfo(channel.id);
  return info?.ownerId === member.id;
}

/**
 * Le salon-panneau partagé n'est visible QUE par qui possède actuellement
 * un salon vocal temporaire actif — demande explicite : "seul la personne
 * qui a créé et accès à la voc peut avoir accès au panel control". Appelé à
 * la création d'un salon temporaire, à sa suppression, et à un transfert de
 * propriété (voir index.js et handleVoiceControlInteraction, action
 * "transferpick"/&voc transfer).
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {boolean} allowed
 */
async function setPanelAccess(guild, userId, allowed) {
  const panelChannelId = voiceChannels.getHubConfig(guild.id).panelChannelId;
  const panelChannel = panelChannelId && guild.channels.cache.get(panelChannelId);
  if (!panelChannel) return;
  // Corrige au passage un salon-panneau créé avant cette restriction
  // (@everyone pouvait encore le voir) — idempotent, sans risque à rejouer.
  await panelChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
  if (allowed) {
    await panelChannel.permissionOverwrites.edit(userId, { ViewChannel: true }, { reason: "Salon vocal temporaire actif" }).catch(() => {});
  } else {
    await panelChannel.permissionOverwrites.delete(userId, "Salon vocal temporaire terminé ou transféré").catch(() => {});
  }
}

async function vc(client, message, args) {
  const channel = message.member.voice.channel;
  if (!channel) return reply(message, "error", "Tu dois être dans un salon vocal temporaire.");
  const info = voiceChannels.getChannelInfo(channel.id);
  if (!info) return reply(message, "error", "Ce salon vocal n'est pas un salon temporaire géré par le bot.");
  if (!canManageVoiceChannel(message.member, channel)) {
    return reply(message, "error", "Seul le propriétaire de ce salon peut le gérer.");
  }

  const sub = (args[0] || "").toLowerCase();
  const everyone = message.guild.roles.everyone;

  if (sub === "lock" || sub === "unlock") {
    await channel.permissionOverwrites
      .edit(everyone, { Connect: sub === "lock" ? false : null }, { reason: `Salon vocal ${sub === "lock" ? "verrouillé" : "déverrouillé"} par ${message.author.tag}` })
      .catch(() => {});
    return reply(message, "success", sub === "lock" ? "Salon verrouillé." : "Salon déverrouillé.");
  }

  if (sub === "limit") {
    const n = parseInt(args[1], 10);
    if (isNaN(n) || n < 0 || n > 99) return reply(message, "error", "Indique une limite entre 0 (illimité) et 99 : `voc limit <n>`.");
    await channel.setUserLimit(n, `Limite changée par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", n === 0 ? "Limite retirée." : `Limite réglée sur **${n}**.`);
  }

  if (sub === "rename") {
    const name = args.slice(1).join(" ").trim();
    if (!name) return reply(message, "error", "Indique un nom : `voc rename <nom>`.");
    await channel.setName(name, `Renommé par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", `Salon renommé **${name}**.`);
  }

  if (sub === "kick") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc kick @membre`.");
    if (target.voice.channelId !== channel.id) return reply(message, "error", "Ce membre n'est pas dans ton salon.");
    await target.voice.disconnect(`Expulsé du salon vocal par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", `**${target.user.tag}** expulsé du salon.`);
  }

  if (sub === "add") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc add @membre`.");
    await channel.permissionOverwrites
      .edit(target, { ViewChannel: true, Connect: true }, { reason: `Accès accordé par ${message.author.tag}` })
      .catch(() => {});
    return reply(message, "success", `**${target.user.tag}** peut désormais rejoindre ce salon, même verrouillé.`);
  }

  if (sub === "remove") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc remove @membre`.");
    await channel.permissionOverwrites.delete(target, `Accès retiré par ${message.author.tag}`).catch(() => {});
    if (target.voice.channelId === channel.id) await target.voice.disconnect(`Accès retiré par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", `Accès de **${target.user.tag}** retiré.`);
  }

  if (sub === "transfer") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc transfer @membre`.");
    if (target.voice.channelId !== channel.id) return reply(message, "error", "Ce membre doit être dans ton salon pour en devenir propriétaire.");
    const previousOwnerId = voiceChannels.getChannelInfo(channel.id)?.ownerId;
    voiceChannels.registerChannel(channel.id, message.guild.id, target.id);
    if (previousOwnerId) await setPanelAccess(message.guild, previousOwnerId, false);
    await setPanelAccess(message.guild, target.id, true);
    return reply(message, "success", `**${target.user.tag}** est désormais propriétaire de ce salon.`);
  }

  return reply(message, "error", "Utilise `voc lock|unlock|limit <n>|rename <nom>|kick @membre|add @membre|remove @membre|transfer @membre`.");
}

// --- Panneau de contrôle PARTAGÉ, un seul salon texte permanent créé par
// &panel > Communauté > Vocaux > "Créer la configuration" (voir
// utils/voiceHubSetup.js) — plus un salon compagnon par salon vocal créé
// puis détruit à chaque fois. Les boutons agissent sur le salon vocal où la
// personne qui clique est CONNECTÉE au moment du clic, exactement comme un
// panneau "Voice Create" classique : mêmes vérifications que la commande
// texte (canManageVoiceChannel), rien de plus permissif.

/** Les mêmes boutons, réutilisés par le panneau partagé ET l'accueil du salon (voir plus bas). */
function voiceControlButtonRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vcpanel:lock").setLabel("Fermer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:unlock").setLabel("Ouvrir").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:add").setLabel("Ajouter").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:remove").setLabel("Retirer").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vcpanel:rename").setLabel("Renommer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:transfer").setLabel("Transférer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:kick").setLabel("Expulser").setStyle(ButtonStyle.Danger)
    ),
  ];
}

/** Panneau de contrôle STATIQUE, posté une seule fois dans le salon-panneau partagé. */
function buildVoiceControlCard() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎛️ Centre de contrôle vocal"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Un seul panneau pour tout le monde : les boutons agissent toujours sur **ton** salon vocal temporaire, " +
        "celui où tu es connecté au moment du clic — peu importe d'où tu cliques.\n" +
        "Toujours accessible en texte, où que tu sois : `&voc lock|unlock|limit <n>|rename <nom>|kick|add|remove|transfer @membre`."
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(...voiceControlButtonRows());
  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { parse: [] } };
}

/**
 * Message posté dans le chat du salon VOCAL lui-même à sa création : il
 * mentionne le propriétaire (d'où allowedMentions, sans quoi le client
 * Discord.js n'envoie aucune notification — voir index.js) avec un seul
 * bouton "Gérer ton salon" qui emmène directement au salon-panneau partagé
 * (accès garanti : setPanelAccess donne la vue à cette personne dès la
 * création de son salon). Sans salon-panneau configuré (serveur pas encore
 * passé par "Créer la configuration"), repli sur un bouton qui ouvre les
 * mêmes contrôles en ÉPHÉMÈRE plutôt que de ne rien proposer du tout.
 */
function buildVoiceWelcomeCard(channel, ownerId, panelChannelId) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔊 <@${ownerId}>, ton salon est prêt`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const bouton = panelChannelId
    ? new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Gérer ton salon")
        .setURL(`https://discord.com/channels/${channel.guildId}/${panelChannelId}`)
    : new ButtonBuilder().setCustomId("vcpanel:menu").setLabel("Gérer ton salon").setStyle(ButtonStyle.Primary);
  container.addActionRowComponents(new ActionRowBuilder().addComponents(bouton));
  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { users: [ownerId] } };
}

async function handleVoiceControlInteraction(interaction) {
  const [, action] = interaction.customId.split(":");

  // Le panneau est PARTAGÉ (un seul salon pour tout le monde) : le salon
  // ciblé est celui où la personne qui clique est connectée EN VOCAL à cet
  // instant, pas celui où elle a cliqué. Doit être un salon TEMPORAIRE
  // réellement enregistré (voiceChannels.getChannelInfo), sinon même le
  // générateur lui-même serait manipulable. Même garde-fou que la commande
  // texte &voc (ci-dessus).
  const voiceChannelId = interaction.member?.voice?.channelId;
  const channel = voiceChannelId ? interaction.guild.channels.cache.get(voiceChannelId) : null;
  const isTempChannel = channel?.type === ChannelType.GuildVoice && voiceChannels.getChannelInfo(channel.id);
  if (!isTempChannel) {
    return interaction.reply({
      content: "Rejoins d'abord TON salon vocal temporaire (créé en rejoignant le générateur), puis reclique.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!canManageVoiceChannel(interaction.member, channel)) {
    return interaction.reply({ content: "Seul le propriétaire de ce salon peut le gérer.", flags: MessageFlags.Ephemeral });
  }

  // Repli du bouton "Gérer ton salon" de l'accueil du vocal (voir
  // buildVoiceWelcomeCard) quand aucun salon-panneau n'est configuré — sinon
  // c'est un vrai bouton-lien qui y emmène directement.
  if (action === "menu") {
    const menu = new ContainerBuilder();
    menu.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎛️ ${channel.name}`));
    menu.addActionRowComponents(...voiceControlButtonRows());
    return interaction.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [menu] });
  }

  if (action === "lock" || action === "unlock") {
    await channel.permissionOverwrites
      .edit(interaction.guild.roles.everyone, { Connect: action === "lock" ? false : null }, { reason: `Salon vocal ${action === "lock" ? "verrouillé" : "déverrouillé"} par ${interaction.user.tag}` })
      .catch(() => {});
    return interaction.reply({ content: action === "lock" ? "Salon verrouillé." : "Salon déverrouillé.", flags: MessageFlags.Ephemeral });
  }

  if (action === "rename") {
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rien n'a changé.", flags: MessageFlags.Ephemeral });
      await channel.setName(name, `Renommé par ${interaction.user.tag}`).catch(() => {});
      return interaction.reply({ content: `Salon renommé **${name}**.`, flags: MessageFlags.Ephemeral });
    }
    const modal = new ModalBuilder().setCustomId("vcpanel:rename").setTitle("Renommer le salon");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (["add", "remove", "transfer", "kick"].includes(action)) {
    return interaction.reply({
      content: `Choisis un membre pour "${{ add: "Ajouter", remove: "Retirer", transfer: "Transférer la propriété", kick: "Expulser" }[action]}".`,
      components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`vcpanel:${action}pick`).setPlaceholder("Choisir un membre"))],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (["addpick", "removepick", "transferpick", "kickpick"].includes(action)) {
    const target = await interaction.guild.members.fetch(interaction.values[0]).catch(() => null);
    if (!target) return interaction.reply({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });

    if (action === "addpick") {
      await channel.permissionOverwrites.edit(target, { ViewChannel: true, Connect: true }, { reason: `Accès accordé par ${interaction.user.tag}` }).catch(() => {});
      return interaction.update({ content: `**${target.user.tag}** peut désormais rejoindre ce salon, même verrouillé.`, components: [] });
    }
    if (action === "removepick") {
      await channel.permissionOverwrites.delete(target, `Accès retiré par ${interaction.user.tag}`).catch(() => {});
      if (target.voice.channelId === channel.id) await target.voice.disconnect(`Accès retiré par ${interaction.user.tag}`).catch(() => {});
      return interaction.update({ content: `Accès de **${target.user.tag}** retiré.`, components: [] });
    }
    if (action === "transferpick") {
      if (target.voice.channelId !== channel.id) {
        return interaction.update({ content: "Ce membre doit être dans le salon pour en devenir propriétaire.", components: [] });
      }
      const previousOwnerId = voiceChannels.getChannelInfo(channel.id)?.ownerId;
      voiceChannels.registerChannel(channel.id, interaction.guild.id, target.id);
      if (previousOwnerId) await setPanelAccess(interaction.guild, previousOwnerId, false);
      await setPanelAccess(interaction.guild, target.id, true);
      return interaction.update({ content: `**${target.user.tag}** est désormais propriétaire de ce salon.`, components: [] });
    }
    if (action === "kickpick") {
      if (target.voice.channelId !== channel.id) return interaction.update({ content: "Ce membre n'est pas dans le salon.", components: [] });
      await target.voice.disconnect(`Expulsé du salon vocal par ${interaction.user.tag}`).catch(() => {});
      return interaction.update({ content: `**${target.user.tag}** expulsé du salon.`, components: [] });
    }
  }
}

module.exports = {
  owners,
  antinuke,
  whitelist,
  allbots,
  handleServerAdminInteraction,
  roleAdmin,
  channelAdmin,
  dero,
  applyDeroToNewChannel,
  voicehub,
  vc,
  buildVoiceControlCard,
  buildVoiceWelcomeCard,
  handleVoiceControlInteraction,
  setPanelAccess,
  handleConfirmInteraction,
  requestConfirmation,
  ROLE_ADMIN_SUBCOMMANDS,
  ID,
};
