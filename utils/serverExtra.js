const {
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const { formatDuration, parseDuration } = require("./moderationCommands");
const { requestConfirmation } = require("./serverAdminCommands");
const tempRoleStore = require("./tempRoleStore");
const autoReactStore = require("./autoReactStore");

// Extensions de la catégorie "Gestion du serveur" documentées dans le panel
// mais pas encore câblées — voir utils/commandCatalog.js.

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/** Cible = PREMIER argument exactement (mention ou ID) — même règle que utils/moderationExtra.js. */
function parseTarget(args) {
  const mentionMatch = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const idMatch = args[0]?.match(/^\d{15,25}$/);
  return mentionMatch?.[1] || idMatch?.[0] || null;
}

async function fetchTargetOrReply(message, targetId) {
  if (!targetId) {
    await reply(message, "error", "Indique un membre (mention ou identifiant) en premier argument.");
    return null;
  }
  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    await reply(message, "error", "Ce membre n'est pas sur le serveur.");
    return null;
  }
  return target;
}

// --- &choose <option1>,,<option2>,,... ---

async function choose(client, message, args) {
  if (!can(message.member, "server.tools.use")) return;
  const options = args
    .join(" ")
    .split(",,")
    .map((o) => o.trim())
    .filter(Boolean);
  if (options.length < 2) return reply(message, "error", "Indique au moins 2 options séparées par `,,` : `choose pizza,,burger,,sushi`.");
  const picked = options[Math.floor(Math.random() * options.length)];
  return reply(message, "info", `Choix : **${picked}**`);
}

// --- &embed (constructeur simple via modale) ---

/** &embed passe par un bouton (les commandes texte ne peuvent pas ouvrir de modale directement) — voir handleEmbedButton/handleEmbedModal. */
async function embedPrompt(client, message) {
  if (!can(message.member, "server.channels.manage")) return;
  return message.reply({
    embeds: [buildStatusEmbed("info", "Clique pour ouvrir le constructeur d'embed.")],
    components: [
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("srvextra:embedopen").setLabel("Construire un embed").setStyle(ButtonStyle.Secondary)),
    ],
  });
}

async function handleEmbedButton(interaction) {
  if (!can(interaction.member, "server.channels.manage")) return interaction.reply({ content: "Accès refusé.", ephemeral: true });
  const modal = new ModalBuilder().setCustomId("srvextra:embed").setTitle("Constructeur d'embed");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("title").setLabel("Titre").setStyle(TextInputStyle.Short).setMaxLength(256).setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("description").setLabel("Description").setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("color").setLabel("Couleur (hex, ex : #5865F2)").setStyle(TextInputStyle.Short).setMaxLength(7).setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("image").setLabel("Image (lien)").setStyle(TextInputStyle.Short).setRequired(false)
    )
  );
  return interaction.showModal(modal);
}

async function handleEmbedModal(interaction) {
  const title = interaction.fields.getTextInputValue("title").trim();
  const description = interaction.fields.getTextInputValue("description").trim();
  const color = interaction.fields.getTextInputValue("color").trim();
  const image = interaction.fields.getTextInputValue("image").trim();

  const built = new EmbedBuilder().setDescription(description);
  if (title) built.setTitle(title);
  if (/^#?[0-9a-f]{6}$/i.test(color)) built.setColor(parseInt(color.replace("#", ""), 16));
  if (/^https?:\/\//i.test(image)) built.setImage(image);

  await interaction.channel.send({ embeds: [built] }).catch(() => {});
  return interaction.reply({ content: "Embed envoyé.", ephemeral: true });
}

// --- &create [émoji/lien] [nom] (crée un emoji sur le serveur) ---

async function createEmoji(client, message, args) {
  if (!can(message.member, "server.channels.manage")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageGuildExpressions ?? PermissionFlagsBits.ManageEmojisAndStickers, "ManageEmojisAndStickers");
  if (botPerm) return reply(message, "error", botPerm);

  const attachment = message.attachments.first()?.url;
  const customEmojiMatch = args[0]?.match(/^<a?:\w+:(\d+)>$/);
  const url = attachment || (customEmojiMatch ? `https://cdn.discordapp.com/emojis/${customEmojiMatch[1]}.png` : args[0]);
  const name = (customEmojiMatch ? args[1] : args.slice(attachment ? 0 : 1).join(" ")).trim() || "emoji";

  if (!url || !/^https?:\/\//i.test(url)) {
    return reply(message, "error", "Indique un lien d'image, un émoji existant, ou joins un fichier : `create <lien|émoji> <nom>`.");
  }

  let created;
  try {
    created = await message.guild.emojis.create({ attachment: url, name: name.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32) || "emoji" });
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }
  await report(client, {
    guildId: message.guild.id,
    category: "server",
    title: "Émoji créé",
    fields: [{ label: "Émoji", value: `${created} (\`${created.name}\`)` }],
    action: "emoji_create",
    targetId: created.id,
    targetTag: created.name,
    moderator: message.author,
    channelId: message.channel.id,
  });
  return reply(message, "success", `Émoji ${created} créé.`);
}

// --- &massiverole / &unmassiverole ---

async function massRole(client, message, { remove }) {
  if (!can(message.member, "server.roles.manage")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const roles = [...message.mentions.roles.values()];
  if (!roles.length) return reply(message, "error", `Indique au moins un rôle : \`${remove ? "unmassiverole" : "massiverole"} @rôle [@rôle...]\`.`);

  const me = message.guild.members.me;
  const unmanageable = roles.filter((r) => me.roles.highest.position <= r.position);
  if (unmanageable.length) return reply(message, "error", `Mon rôle est trop bas pour gérer : ${unmanageable.map((r) => r.name).join(", ")}.`);

  await reply(message, "info", `Application à tous les membres en cours (${roles.length} rôle(s))... ça peut prendre un moment.`);
  const members = await message.guild.members.fetch();
  let count = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    try {
      if (remove) await member.roles.remove(roles, `Retrait de masse par ${message.author.tag}`);
      else await member.roles.add(roles, `Ajout de masse par ${message.author.tag}`);
      count++;
    } catch {
      // Un échec isolé (hiérarchie, membre parti entre-temps) ne doit pas interrompre le reste.
    }
  }

  await report(client, {
    guildId: message.guild.id,
    category: "server",
    title: remove ? "Retrait de rôle de masse" : "Ajout de rôle de masse",
    fields: [
      { label: "Rôles", value: roles.map((r) => r.name).join(", ") },
      { label: "Membres concernés", value: String(count) },
    ],
    action: remove ? "unmassiverole" : "massiverole",
    targetId: null,
    targetTag: null,
    moderator: message.author,
    channelId: message.channel.id,
    extra: { roleIds: roles.map((r) => r.id), count },
  });
  return reply(message, "success", `${remove ? "Retiré de" : "Ajouté à"} **${count}** membre(s).`);
}

// --- &voicemove / &voicekick / &bringall ---

async function voicemove(client, message) {
  if (!can(message.member, "server.voice.moveall")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.MoveMembers, "MoveMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const channels = [...message.mentions.channels.values()].filter((c) => c.type === ChannelType.GuildVoice);
  const [from, to] = channels;
  if (!from || !to) return reply(message, "error", "Indique deux salons vocaux : `voicemove #depuis #vers`.");

  let count = 0;
  for (const member of from.members.values()) {
    await member.voice.setChannel(to, `Déplacement de masse par ${message.author.tag}`).catch(() => {});
    count++;
  }
  return reply(message, "success", `**${count}** membre(s) déplacé(s) de ${from} vers ${to}.`);
}

async function voicekick(client, message, args) {
  if (!can(message.member, "server.voice.manage")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.MoveMembers, "MoveMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;
  if (!target.voice.channel) return reply(message, "info", `${target.user.tag} n'est pas en vocal.`);

  await target.voice.disconnect(`Expulsion vocale par ${message.author.tag}`).catch(() => {});
  return reply(message, "success", `**${target.user.tag}** expulsé du vocal.`);
}

async function bringall(client, message) {
  if (!can(message.member, "server.voice.moveall")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.MoveMembers, "MoveMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const destination = message.mentions.channels.first() || message.member.voice.channel;
  if (!destination || destination.type !== ChannelType.GuildVoice) {
    return reply(message, "error", "Indique un salon vocal ou rejoins-en un : `bringall [#salon]`.");
  }

  let count = 0;
  for (const channel of message.guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).values()) {
    if (channel.id === destination.id) continue;
    for (const member of channel.members.values()) {
      await member.voice.setChannel(destination, `Rassemblement par ${message.author.tag}`).catch(() => {});
      count++;
    }
  }
  return reply(message, "success", `**${count}** membre(s) rassemblé(s) dans ${destination}.`);
}

// --- &unbanall (confirmation obligatoire, comme &banall) ---

async function unbanall(client, message) {
  if (!can(message.member, "moderation.unbanall")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers");
  if (botPerm) return reply(message, "error", botPerm);

  const bans = await message.guild.bans.fetch().catch(() => null);
  if (!bans || !bans.size) return reply(message, "info", "Personne n'est banni.");

  return requestConfirmation(message, {
    title: "Confirmer le débannissement de masse",
    body: `**${bans.size}** membre(s) actuellement banni(s) seront débannis. Cette action ne peut pas être annulée automatiquement.`,
    confirmLabel: "Débannir tout le monde",
    permission: "moderation.unbanall",
    execute: async (interaction) => {
      const currentBans = await interaction.guild.bans.fetch().catch(() => null);
      let count = 0;
      for (const ban of currentBans?.values() || []) {
        await interaction.guild.members.unban(ban.user.id, `Débannissement de masse par ${interaction.user.tag}`).catch(() => {});
        count++;
      }
      await report(interaction.client, {
        guildId: interaction.guild.id,
        category: "server",
        title: "Débannissement de masse",
        fields: [{ label: "Membres débannis", value: String(count) }],
        action: "unbanall",
        targetId: null,
        targetTag: null,
        moderator: interaction.user,
        channelId: interaction.channel?.id || null,
        extra: { count },
      });
      await interaction.update({ embeds: [buildStatusEmbed("success", `**${count}** membre(s) débanni(s).`)], components: [] });
    },
  });
}

// --- &temprole / &untemprole ---

async function temprole(client, message, args) {
  if (!can(message.member, "members.role")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;

  const role = message.mentions.roles?.first();
  if (!role) return reply(message, "error", "Indique un rôle : `temprole @membre @rôle <durée>`.");

  const refusal = checkHierarchy(message.guild, message.member, target);
  if (refusal) return reply(message, "error", refusal);

  const durationArg = args.find((a) => /^\d+[smhd]$/i.test(a));
  const durationMs = parseDuration(durationArg);
  if (!durationMs) return reply(message, "error", "Indique une durée valide : `temprole @membre @rôle 1d`.");

  if (target.roles.cache.has(role.id)) return reply(message, "info", `${target.user.tag} a déjà ce rôle.`);

  try {
    await target.roles.add(role, `Rôle temporaire par ${message.author.tag} (${formatDuration(durationMs)})`);
  } catch (err) {
    return reply(message, "error", `Discord a refusé : ${err.message}`);
  }
  tempRoleStore.add(message.guild.id, target.id, role.id, Date.now() + durationMs);

  await report(client, {
    guildId: message.guild.id,
    category: "members",
    title: "Rôle temporaire ajouté",
    fields: [
      { label: "Cible", value: `<@${target.id}> (${target.id})` },
      { label: "Rôle", value: role.name },
      { label: "Durée", value: formatDuration(durationMs) },
    ],
    action: "temprole",
    targetId: target.id,
    targetTag: target.user.tag,
    moderator: message.author,
    channelId: message.channel.id,
  });
  return reply(message, "success", `**${role.name}** donné à **${target.user.tag}** pour ${formatDuration(durationMs)}.`);
}

async function untemprole(client, message, args) {
  if (!can(message.member, "members.role")) return;
  const targetId = parseTarget(args);
  const target = await fetchTargetOrReply(message, targetId);
  if (!target) return;
  const role = message.mentions.roles?.first();
  if (!role) return reply(message, "error", "Indique un rôle : `untemprole @membre @rôle`.");

  tempRoleStore.remove(message.guild.id, target.id, role.id);
  if (target.roles.cache.has(role.id)) await target.roles.remove(role, `Rôle temporaire retiré par ${message.author.tag}`).catch(() => {});
  return reply(message, "success", `**${role.name}** retiré de **${target.user.tag}**.`);
}

/** Appelé périodiquement (voir index.js) pour retirer les rôles temporaires arrivés à échéance. */
async function checkExpiredTempRoles(client) {
  for (const entry of tempRoleStore.getExpired()) {
    tempRoleStore.remove(entry.guildId, entry.userId, entry.roleId);
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;
    const role = guild.roles.cache.get(entry.roleId);
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    if (!role || !member || !member.roles.cache.has(role.id)) continue;
    await member.roles.remove(role, "Fin du rôle temporaire").catch(() => {});
    await report(client, {
      guildId: entry.guildId,
      category: "members",
      title: "Fin du rôle temporaire",
      fields: [{ label: "Cible", value: `<@${member.id}> (${member.id})` }, { label: "Rôle", value: role.name }],
      action: "untemprole",
      targetId: member.id,
      targetTag: member.user.tag,
      moderator: client.user,
      channelId: null,
    }).catch(() => {});
  }
}

// --- &sync <#salon/catégorie/all> ---

async function sync(client, message, args) {
  if (!can(message.member, "server.channels.manage")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const mode = (args[0] || "").toLowerCase();
  const mentioned = message.mentions.channels?.first();

  const syncOne = async (channel) => {
    if (!channel.parent) return false;
    await channel.lockPermissions().catch(() => {});
    return true;
  };

  if (mode === "all") {
    let count = 0;
    for (const channel of message.guild.channels.cache.values()) {
      if (await syncOne(channel)) count++;
    }
    return reply(message, "success", `**${count}** salon(s) resynchronisé(s) avec leur catégorie.`);
  }

  const targetChannel = mentioned || message.channel;
  if (targetChannel.type === ChannelType.GuildCategory) {
    let count = 0;
    for (const channel of message.guild.channels.cache.filter((c) => c.parentId === targetChannel.id).values()) {
      if (await syncOne(channel)) count++;
    }
    return reply(message, "success", `**${count}** salon(s) de la catégorie **${targetChannel.name}** resynchronisé(s).`);
  }

  if (!targetChannel.parent) return reply(message, "error", "Ce salon n'a pas de catégorie parente à synchroniser.");
  await syncOne(targetChannel);
  return reply(message, "success", `${targetChannel} resynchronisé avec sa catégorie.`);
}

// --- &cleanup <#salon> (messages de webhooks / membres partis) ---

async function cleanup(client, message) {
  if (!can(message.member, "server.channels.manage")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageMessages, "ManageMessages");
  if (botPerm) return reply(message, "error", botPerm);

  const channel = message.mentions.channels?.first() || message.channel;
  const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!batch) return reply(message, "error", "Impossible de lire ce salon.");

  const toDelete = [];
  for (const m of batch.values()) {
    if (m.webhookId) {
      toDelete.push(m);
      continue;
    }
    if (m.author.bot) continue;
    const stillMember = message.guild.members.cache.has(m.author.id);
    if (!stillMember) toDelete.push(m);
  }
  if (!toDelete.length) return reply(message, "info", "Rien à nettoyer sur les 100 derniers messages.");

  await channel.bulkDelete(toDelete, true).catch(() => {});
  return reply(message, "success", `**${toDelete.length}** message(s) nettoyé(s) (webhooks / membres partis) dans ${channel}.`);
}

// --- &autoreact add/del/list ---

async function autoreact(client, message, args) {
  if (!can(message.member, "server.channels.manage")) return;
  const sub = (args[0] || "").toLowerCase();

  if (sub === "list") {
    const rows = autoReactStore.listForGuild(message.guild);
    if (!rows.length) return reply(message, "info", "Aucune réaction automatique configurée.");
    const lines = rows.map((r) => `<#${r.channelId}> : ${r.emojis.join(" ")}`);
    return reply(message, "info", lines.join("\n"));
  }

  if (sub !== "add" && sub !== "del") return reply(message, "error", "Utilise : `autoreact add <#salon> <émoji>`, `autoreact del <#salon> <émoji>`, ou `autoreact list`.");

  const channel = message.mentions.channels?.first();
  if (!channel) return reply(message, "error", "Indique un salon : `autoreact add #salon 👍`.");
  const emoji = args.slice(1).find((a) => !a.startsWith("<#"));
  if (!emoji) return reply(message, "error", "Indique un émoji : `autoreact add #salon 👍`.");

  if (sub === "add") {
    const added = autoReactStore.add(channel.id, emoji);
    return reply(message, added ? "success" : "info", added ? `${emoji} sera ajouté automatiquement dans ${channel}.` : "Déjà configuré.");
  }
  const removed = autoReactStore.remove(channel.id, emoji);
  return reply(message, removed ? "success" : "info", removed ? `${emoji} retiré des réactions automatiques de ${channel}.` : "Cet émoji n'était pas configuré.");
}

/** À appeler dans messageCreate — ne fait rien si le salon n'a rien de configuré. */
async function applyAutoReact(message) {
  if (message.author.bot || !message.guild) return;
  const emojis = autoReactStore.getForChannel(message.channel.id);
  for (const emoji of emojis) {
    await message.react(emoji).catch(() => {});
  }
}

module.exports = {
  choose,
  embedPrompt,
  handleEmbedButton,
  handleEmbedModal,
  createEmoji,
  massiverole: (client, message) => massRole(client, message, { remove: false }),
  unmassiverole: (client, message) => massRole(client, message, { remove: true }),
  voicemove,
  voicekick,
  bringall,
  unbanall,
  temprole,
  untemprole,
  checkExpiredTempRoles,
  sync,
  cleanup,
  autoreact,
  applyAutoReact,
};
