const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { isOwner } = require("./antiNukeStore");
const { addToBlacklist, removeFromBlacklist, getBlacklistEntry, getBlacklist } = require("./blacklistStore");
const { saveGuildConfig } = require("./configChannel");
const { sendLog } = require("./actionLogger");
const { buildHelpPanel } = require("./helpPanels");
const { getPrefixes } = require("./prefixStore");

/**
 * Résout un membre visé par une sous-commande blacklist : mention, ou ID brut
 * (le blacklist doit aussi fonctionner sur quelqu'un qui n'est plus/pas
 * encore sur le serveur, donc pas de guild.members.fetch obligatoire).
 * @param {import('discord.js').Message} message
 * @param {string} raw
 * @returns {Promise<{ id: string, tag: string }|null>}
 */
async function resolveUserArg(message, raw) {
  const mentioned = message.mentions.users?.first();
  if (mentioned) return { id: mentioned.id, tag: mentioned.tag };

  const id = (raw || "").replace(/[<@!>]/g, "");
  if (!/^\d{15,}$/.test(id)) return null;

  const user = await message.client.users.fetch(id).catch(() => null);
  return { id, tag: user?.tag || id };
}

function requireOwner(message, prefix) {
  if (!isOwner(message.guild, message.author.id)) {
    message.reply({ embeds: [buildStatusEmbed("error", `Réservé aux owners anti-nuke de ce serveur (voir \`${prefix}owner\` sur le bot Antifast).`)] });
    return false;
  }
  return true;
}

/**
 * `=blacklist add|remove|check|list` — liste noire locale à ce serveur.
 * Un membre blacklisté est automatiquement banni s'il rejoint (voir
 * checkBlacklistOnJoin, appelé sur "guildMemberAdd" dans blacklist.js).
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 * @param {string} prefix — préfixe configuré de ce bot, pour les messages d'usage
 */
async function handleBlacklistCommand(message, args, prefix = "=") {
  const sub = (args[0] || "").toLowerCase();

  if (sub === "list") {
    if (!requireOwner(message, prefix)) return;
    const entries = getBlacklist(message.guildId);
    if (entries.length === 0) {
      return message.reply({ embeds: [buildStatusEmbed("info", "Blacklist vide sur ce serveur.")] });
    }
    const lines = entries
      .slice(0, 25)
      .map((e) => `<@${e.userId}> (\`${e.userId}\`) — ${e.reason}`)
      .join("\n");
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Blacklist (${entries.length})`)
          .setDescription(lines + (entries.length > 25 ? `\n*+${entries.length - 25} autre(s)*` : ""))
          .setColor(0xed4245),
      ],
      allowedMentions: { parse: [] },
    });
  }

  if (sub === "add") {
    if (!requireOwner(message, prefix)) return;
    const target = await resolveUserArg(message, args[1]);
    if (!target) {
      return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : \`${prefix}blacklist add @membre|<id> [raison]\``)] });
    }
    if (target.id === message.author.id || target.id === message.client.user.id) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Tu ne peux pas blacklister ça.")] });
    }
    const reason = args.slice(2).join(" ") || "Aucune raison fournie";
    addToBlacklist(message.guildId, target.id, { reason, addedById: message.author.id });
    await saveGuildConfig(message.guild, ["blacklist"]);

    sendLog(message.client, message.guildId, "blacklist", {
      title: "Ajout blacklist",
      description: `**${target.tag}** (\`${target.id}\`) ajouté à la blacklist.`,
      actor: message.author,
      fields: [{ name: "Raison", value: reason, inline: false }],
    });

    // Si la cible est déjà sur le serveur, on applique tout de suite.
    const member = await message.guild.members.fetch(target.id).catch(() => null);
    let banned = false;
    if (member && message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers) && member.bannable) {
      banned = await member
        .ban({ reason: `Blacklist : ${reason}` })
        .then(() => true)
        .catch(() => false);
    }

    await message.reply({
      embeds: [
        buildStatusEmbed(
          "success",
          `**${target.tag}** ajouté à la blacklist.${banned ? " Déjà présent sur le serveur → banni automatiquement." : ""}`
        ),
      ],
    });
    return;
  }

  if (sub === "remove") {
    if (!requireOwner(message, prefix)) return;
    const target = await resolveUserArg(message, args[1]);
    if (!target) {
      return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : \`${prefix}blacklist remove @membre|<id>\``)] });
    }
    const removed = removeFromBlacklist(message.guildId, target.id);
    if (!removed) {
      return message.reply({ embeds: [buildStatusEmbed("info", `**${target.tag}** n'est pas blacklisté.`)] });
    }
    await saveGuildConfig(message.guild, ["blacklist"]);
    sendLog(message.client, message.guildId, "blacklist", {
      title: "Retrait blacklist",
      description: `**${target.tag}** (\`${target.id}\`) retiré de la blacklist.`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `**${target.tag}** retiré de la blacklist.`)] });
  }

  if (sub === "check") {
    if (!requireOwner(message, prefix)) return;
    const target = await resolveUserArg(message, args[1]);
    if (!target) {
      return message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : \`${prefix}blacklist check @membre|<id>\``)] });
    }
    const entry = getBlacklistEntry(message.guildId, target.id);
    if (!entry) {
      return message.reply({ embeds: [buildStatusEmbed("info", `**${target.tag}** n'est pas blacklisté.`)] });
    }
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "warning",
          `**${target.tag}** est blacklisté.\n**Raison :** ${entry.reason}\n**Ajouté par :** <@${entry.addedById}>\n**Le :** <t:${Math.floor(entry.addedAt / 1000)}:f>`
        ),
      ],
      allowedMentions: { parse: [] },
    });
  }

  return message.reply({
    embeds: [buildStatusEmbed("error", `Utilisation : \`${prefix}blacklist add|remove|check|list [@membre|<id>] [raison]\``)],
  });
}

/**
 * À appeler sur l'event "guildMemberAdd" : bannit automatiquement un nouveau
 * membre s'il est blacklisté sur ce serveur.
 * @param {import('discord.js').GuildMember} member
 */
async function checkBlacklistOnJoin(member) {
  const entry = getBlacklistEntry(member.guild.id, member.id);
  if (!entry) return;
  if (!member.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers) || !member.bannable) return;

  const banned = await member
    .ban({ reason: `Blacklist : ${entry.reason}` })
    .then(() => true)
    .catch((err) => {
      console.error("[blacklist] Échec du bannissement automatique :", err);
      return false;
    });

  if (banned) {
    sendLog(member.client, member.guild.id, "blacklist", {
      title: "Bannissement automatique (blacklist)",
      description: `**${member.user.tag}** (\`${member.id}\`) a rejoint le serveur et a été banni automatiquement (blacklisté).`,
      fields: [{ name: "Raison", value: entry.reason, inline: false }],
    });
  }
}

function buildBlacklistHelpPanel(prefix) {
  return buildHelpPanel({
    title: "Aide — Bot Blacklist",
    intro: `Préfixe : \`${prefix}\``,
    sections: [
      {
        heading: "Blacklist",
        lines: [
          `\`${prefix}blacklist add @membre|<id> [raison]\` — Ajoute à la blacklist (banni tout de suite si déjà présent, banni automatiquement à l'arrivée sinon)`,
          `\`${prefix}blacklist remove @membre|<id>\` — Retire de la blacklist`,
          `\`${prefix}blacklist check @membre|<id>\` — Vérifie si quelqu'un est blacklisté`,
          `\`${prefix}blacklist list\` — Liste la blacklist du serveur`,
        ],
      },
    ],
    footer: `Réservé aux owners anti-nuke de ce serveur (voir \`${prefix}owner\` sur le bot Antifast).`,
  });
}

const dispatchHandlers = {
  help: (client, message, args, prefix) => message.channel.send(buildBlacklistHelpPanel(prefix)),
  blacklist: (client, message, args, prefix) => handleBlacklistCommand(message, args, prefix),
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot Blacklist. Le préfixe est
 * configurable par serveur via `.panel` (bot Musique+Modération) — voir
 * utils/prefixStore.js/prefixPanel.js.
 */
async function handleBlacklistTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { blacklist: BLACKLIST_PREFIX } = getPrefixes(message.guild.id);
  if (!content.startsWith(BLACKLIST_PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(BLACKLIST_PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (!dispatchHandlers[cmd]) return;

  return dispatchHandlers[cmd](client, message, args, BLACKLIST_PREFIX);
}

module.exports = { handleBlacklistCommand, checkBlacklistOnJoin, handleBlacklistTextCommand };
