const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const { getLogChannelId } = require("./modLogStore");

// Toute action qui compte comme "modération" au sens large : ce que fait ce
// bot (&ban/&unban/&banall), ce que fait le CrowBot du serveur, et ce que
// fait n'importe quel modérateur humain — le journal d'audit Discord retient
// l'exécuteur réel quel que soit le bot ou la personne qui a agi, donc ce
// seul mécanisme couvre les trois sans avoir à instrumenter chaque commande
// ni à lire quoi que ce soit chez le CrowBot.
//
// Volontairement pas exhaustif : les entrées bruyantes et rarement utiles en
// modération (changement de pseudo, mise à jour de salon mineure, épinglage
// de message...) sont omises pour que le salon de logs reste lisible.
const HANDLERS = {
  [AuditLogEvent.MemberBanAdd]: {
    color: 0xed4245,
    describe: (e) => `🔨 **Bannissement** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.MemberBanRemove]: {
    color: 0x57f287,
    describe: (e) => `♻️ **Débannissement** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.MemberKick]: {
    color: 0xed4245,
    describe: (e) => `👢 **Expulsion** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.MemberUpdate]: {
    color: 0xfee75c,
    // Seul le changement de timeout nous intéresse ici — un MemberUpdate
    // couvre aussi les surnoms, la sourdine vocale, etc.
    describe: (e) => {
      const change = e.changes.find((c) => c.key === "communication_disabled_until");
      if (!change) return null;
      if (change.new) {
        const until = Math.floor(new Date(change.new).getTime() / 1000);
        return `🔇 **Timeout** — ${targetLabel(e)} jusqu'à <t:${until}:f>${reasonLine(e)}`;
      }
      return `🔊 **Fin de timeout** — ${targetLabel(e)}${reasonLine(e)}`;
    },
  },
  [AuditLogEvent.MemberRoleUpdate]: {
    color: 0xfee75c,
    describe: (e) => {
      const added = e.changes.find((c) => c.key === "$add")?.new;
      const removed = e.changes.find((c) => c.key === "$remove")?.new;
      const parts = [];
      if (added?.length) parts.push(`+ ${added.map((r) => r.name).join(", ")}`);
      if (removed?.length) parts.push(`− ${removed.map((r) => r.name).join(", ")}`);
      if (!parts.length) return null;
      return `🎭 **Rôles modifiés** — ${targetLabel(e)} (${parts.join(" / ")})${reasonLine(e)}`;
    },
  },
  [AuditLogEvent.ChannelCreate]: {
    color: 0x5865f2,
    describe: (e) => `➕ **Salon créé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.ChannelDelete]: {
    color: 0xed4245,
    describe: (e) => `🗑️ **Salon supprimé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.RoleCreate]: {
    color: 0x5865f2,
    describe: (e) => `➕ **Rôle créé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.RoleDelete]: {
    color: 0xed4245,
    describe: (e) => `🗑️ **Rôle supprimé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.WebhookCreate]: {
    color: 0xed4245,
    describe: (e) => `🪝 **Webhook créé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.MessageBulkDelete]: {
    color: 0xfee75c,
    describe: (e) => `🧹 **Nettoyage** — ${e.extra?.count ?? "?"} message(s) supprimé(s) dans ${channelLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.BotAdd]: {
    color: 0xed4245,
    describe: (e) => `🤖 **Bot ajouté** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.MemberDisconnect]: {
    color: 0xfee75c,
    describe: (e) => `🔌 **Déconnexion vocale forcée** — ${e.extra?.count ?? "?"} membre(s)${reasonLine(e)}`,
  },
};

function targetLabel(entry) {
  const t = entry.target;
  if (t?.tag) return `**${t.tag}** (${t.id ?? entry.targetId})`;
  if (t?.name) return `**${t.name}** (${t.id ?? entry.targetId})`;
  if (entry.targetId) return `\`${entry.targetId}\``;
  return "cible inconnue";
}

function channelLabel(entry) {
  const c = entry.extra?.channel;
  return c?.id ? `<#${c.id}>` : "un salon";
}

function reasonLine(entry) {
  return entry.reason ? `\n> Raison : ${entry.reason}` : "";
}

/**
 * Relaie une entrée du journal d'audit Discord vers le salon de logs
 * configuré via &panel (rubrique Logs), si le serveur en a un. Ne fait rien
 * silencieusement si aucun salon n'est configuré, si le type d'action n'est
 * pas suivi, ou si l'envoi échoue (salon supprimé, permission retirée...).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildAuditLogsEntry} entry
 */
async function relayAuditLogEntry(client, guild, entry) {
  const channelId = getLogChannelId(guild.id);
  if (!channelId) return;

  const handler = HANDLERS[entry.action];
  if (!handler) return;

  let description;
  try {
    description = handler.describe(entry);
  } catch (err) {
    console.error("[moderationLog] échec de description d'une entrée d'audit :", err);
    return;
  }
  if (!description) return;

  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(handler.color)
    .setDescription(description)
    .setFooter({ text: entry.executor ? `Par ${entry.executor.tag}` : "Exécuteur inconnu" })
    .setTimestamp(entry.createdAt);

  // Message permanent, volontairement pas de suppression automatique : c'est
  // tout l'intérêt de ce salon face aux confirmations qui s'effacent d'elles-
  // mêmes ailleurs dans le bot.
  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error(`[moderationLog] échec d'envoi dans le salon de logs (${channelId}) :`, err.message);
  });
}

module.exports = { relayAuditLogEntry };
