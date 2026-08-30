const {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const accessStore = require("./accessStore");
const automod = require("./automod/antiSpam");
const deroStore = require("./deroStore");
const { checkBotPermission, report } = require("./moderation/actions");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

const ID = "srv";
const PAGE_SIZE = 10;

// --- Panneau générique liste paginée + ajout/retrait (owners, whitelist) ---
// Mêmes deux UserSelectMenu qu'utils/configPanel.js::accessRows() — un pour
// ajouter, un pour retirer — plutôt que le menu combiné du CrowBot : plus
// simple à maintenir, un seul aller-retour par action.

function card(title, body, rows = []) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body || "*Aucune entrée.*"));
  for (const row of rows) container.addActionRowComponents(row);
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  return { slice: items.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE), page: clamped, totalPages };
}

function buildListCard({ idKind, title, description, items, page, canEdit }) {
  const { slice, page: clampedPage, totalPages } = paginate(items, page);
  const lines = slice.map((item, i) => `${clampedPage * PAGE_SIZE + i + 1}. ${item}`);
  const body = [description, `Nombre actuel : ${items.length}`, "", ...lines].join("\n");

  const rows = [];
  if (totalPages > 1) {
    const options = [];
    if (clampedPage > 0) options.push(new StringSelectMenuOptionBuilder().setLabel("Page précédente").setValue(String(clampedPage - 1)));
    if (clampedPage < totalPages - 1) options.push(new StringSelectMenuOptionBuilder().setLabel("Page suivante").setValue(String(clampedPage + 1)));
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:page:${idKind}`)
          .setPlaceholder(`Page ${clampedPage + 1}/${totalPages}`)
          .addOptions(options)
      )
    );
  }
  if (canEdit) {
    rows.push(
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:add:${idKind}`).setPlaceholder("Ajouter"))
    );
    rows.push(
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:del:${idKind}`).setPlaceholder("Retirer"))
    );
  }
  return card(title, body, rows);
}

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

/** &allbots — lecture seule, réservée au rang sys (comme &sources). */
async function allbots(client, message, args) {
  if (!can(message.member, "sys")) return;
  const bots = [...message.guild.members.cache.filter((m) => m.user.bot).values()].map((m) => `<@${m.id}> (${m.user.tag}, ${m.id})`);
  const page = parseInt(args[0], 10) - 1 || 0;
  await message.reply(
    buildListCard({ idKind: "bots", title: "Liste des bots", description: "Tous les comptes bot présents sur ce serveur.", items: bots, page, canEdit: false })
  );
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

  const list = LISTS[idKind];
  if (!list) return; // "bots" est en lecture seule, aucune interaction à traiter
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
// distinct de &role add/remove qui gère l'appartenance d'un membre — voir
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
  const role = message.mentions.roles?.first();

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

  const target = message.mentions.channels?.first() || message.channel;

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
    const rest = args.filter((a) => !a.startsWith("<#")).slice(1);
    const newName = rest.join(" ").trim();
    if (!newName) return reply(message, "error", "Indique le nouveau nom : `channel rename [#salon] <nom>`.");
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
    const rest = args.filter((a) => !a.startsWith("<#")).slice(1);
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

module.exports = {
  owners,
  whitelist,
  allbots,
  handleServerAdminInteraction,
  roleAdmin,
  channelAdmin,
  dero,
  applyDeroToNewChannel,
  handleConfirmInteraction,
  ROLE_ADMIN_SUBCOMMANDS,
  ID,
};
