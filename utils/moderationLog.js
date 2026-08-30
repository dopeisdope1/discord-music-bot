const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const { getLogChannelId } = require("./modLogStore");
const historyStore = require("./moderationHistoryStore");

// Toute action qui compte comme "modération" au sens large : ce que fait ce
// bot (&ban/&unban/&banall/&kick/...), ce que fait le CrowBot du serveur, et
// ce que fait n'importe quel modérateur humain — le journal d'audit Discord
// retient l'exécuteur réel quel que soit le bot ou la personne qui a agi,
// donc ce seul mécanisme couvre les trois sans avoir à instrumenter chaque
// commande ni à lire quoi que ce soit chez le CrowBot.
//
// IMPORTANT — actions de CE bot : Discord attribue toute action REST à
// l'exécuteur réel (le compte qui a appelé l'API), qui pour une commande de
// CE bot est le compte DU BOT, pas la personne qui a tapé la commande. Ce
// relais ignore donc systématiquement les entrées dont l'exécuteur est le
// bot lui-même (voir relayAuditLogEntry) : ces actions sont déjà journalisées
// avec le VRAI modérateur par utils/moderation/actions.js, qui connaît
// message.author/interaction.user directement.
//
// Volontairement pas exhaustif : les entrées bruyantes et rarement utiles en
// modération (changement de pseudo par soi-même, mise à jour de salon
// mineure, épinglage de message...) sont omises pour que le salon de logs
// reste lisible.
//
// `category` route vers utils/modLogStore.js (un salon par catégorie).
// `history` (optionnel) : quand présent, l'entrée est AUSSI ajoutée à
// utils/moderationHistoryStore.js (recherche via &modlogs/panel) — réservé
// aux actions qui ciblent un membre de façon disciplinaire ; le bruit
// purement "sécurité serveur" (salon/rôle/webhook créés...) reste dans le
// salon de logs sans polluer l'historique de modération.
const HANDLERS = {
  [AuditLogEvent.MemberBanAdd]: {
    category: "moderation",
    color: 0xed4245,
    describe: (e) => `🔨 **Bannissement** — ${targetLabel(e)}${reasonLine(e)}`,
    history: (e) => ({ action: "ban", targetId: e.targetId, targetTag: e.target?.tag || null }),
  },
  [AuditLogEvent.MemberBanRemove]: {
    category: "moderation",
    color: 0x57f287,
    describe: (e) => `♻️ **Débannissement** — ${targetLabel(e)}${reasonLine(e)}`,
    history: (e) => ({ action: "unban", targetId: e.targetId, targetTag: e.target?.tag || null }),
  },
  [AuditLogEvent.MemberKick]: {
    category: "moderation",
    color: 0xed4245,
    describe: (e) => `👢 **Expulsion** — ${targetLabel(e)}${reasonLine(e)}`,
    history: (e) => ({ action: "kick", targetId: e.targetId, targetTag: e.target?.tag || null }),
  },
  [AuditLogEvent.MemberUpdate]: {
    category: "moderation",
    color: 0xfee75c,
    // Un MemberUpdate couvre aussi les surnoms et la sourdine vocale : seuls
    // le timeout et le changement de pseudo nous intéressent ici.
    describe: (e) => {
      const timeout = e.changes.find((c) => c.key === "communication_disabled_until");
      if (timeout) {
        if (timeout.new) {
          const until = Math.floor(new Date(timeout.new).getTime() / 1000);
          return `🔇 **Timeout** — ${targetLabel(e)} jusqu'à <t:${until}:f>${reasonLine(e)}`;
        }
        return `🔊 **Fin de timeout** — ${targetLabel(e)}${reasonLine(e)}`;
      }
      const nick = e.changes.find((c) => c.key === "nick");
      if (nick) return `✏️ **Pseudo modifié** — ${targetLabel(e)} → **${nick.new || "*retiré*"}**${reasonLine(e)}`;
      return null;
    },
    history: (e) => {
      const timeout = e.changes.find((c) => c.key === "communication_disabled_until");
      if (timeout) {
        return {
          action: timeout.new ? "timeout" : "untimeout",
          targetId: e.targetId,
          targetTag: e.target?.tag || null,
          extra: timeout.new ? { until: timeout.new } : null,
        };
      }
      const nick = e.changes.find((c) => c.key === "nick");
      if (nick) return { action: "nick", targetId: e.targetId, targetTag: e.target?.tag || null, extra: { to: nick.new || null } };
      return null;
    },
  },
  [AuditLogEvent.MemberRoleUpdate]: {
    category: "members",
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
    history: (e) => {
      const added = e.changes.find((c) => c.key === "$add")?.new || [];
      const removed = e.changes.find((c) => c.key === "$remove")?.new || [];
      if (!added.length && !removed.length) return null;
      return {
        action: "role",
        targetId: e.targetId,
        targetTag: e.target?.tag || null,
        extra: { added: added.map((r) => r.id), removed: removed.map((r) => r.id) },
      };
    },
  },
  [AuditLogEvent.ChannelUpdate]: {
    category: "channels",
    color: 0xfee75c,
    // Seul le changement de mode lent nous intéresse : le reste (topic, nom,
    // NSFW...) est de la gestion de salon générale, pas de la modération.
    describe: (e) => {
      const slowmode = e.changes.find((c) => c.key === "rate_limit_per_user");
      if (!slowmode) return null;
      const seconds = Number(slowmode.new || 0);
      return seconds
        ? `🐌 **Mode lent** — ${channelMention(e)} réglé sur ${seconds}s${reasonLine(e)}`
        : `🐌 **Mode lent désactivé** — ${channelMention(e)}${reasonLine(e)}`;
    },
    history: (e) => {
      const slowmode = e.changes.find((c) => c.key === "rate_limit_per_user");
      if (!slowmode) return null;
      return { action: "slowmode", targetId: e.targetId, targetTag: null, extra: { seconds: Number(slowmode.new || 0) } };
    },
  },
  [AuditLogEvent.ChannelOverwriteCreate]: {
    category: "channels",
    color: 0xfee75c,
    describe: (e) => overwriteDescribe(e, "créée"),
  },
  [AuditLogEvent.ChannelOverwriteUpdate]: {
    category: "channels",
    color: 0xfee75c,
    describe: (e) => overwriteDescribe(e, "modifiée"),
  },
  [AuditLogEvent.ChannelCreate]: {
    category: "server",
    color: 0x5865f2,
    describe: (e) => `➕ **Salon créé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.ChannelDelete]: {
    category: "server",
    color: 0xed4245,
    describe: (e) => `🗑️ **Salon supprimé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.RoleCreate]: {
    category: "server",
    color: 0x5865f2,
    describe: (e) => `➕ **Rôle créé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.RoleDelete]: {
    category: "server",
    color: 0xed4245,
    describe: (e) => `🗑️ **Rôle supprimé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.WebhookCreate]: {
    category: "server",
    color: 0xed4245,
    describe: (e) => `🪝 **Webhook créé** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.MessageBulkDelete]: {
    category: "moderation",
    color: 0xfee75c,
    describe: (e) => `🧹 **Nettoyage** — ${e.extra?.count ?? "?"} message(s) supprimé(s) dans ${channelLabel(e)}${reasonLine(e)}`,
    // Pas d'écriture d'historique ici : &clear (utils/moderation/actions.js)
    // enregistre déjà une entrée plus riche (avec le filtre utilisé) au
    // moment de l'action — un doublon générique n'ajouterait rien.
  },
  [AuditLogEvent.BotAdd]: {
    category: "bots",
    color: 0xed4245,
    describe: (e) => `🤖 **Bot ajouté** — ${targetLabel(e)}${reasonLine(e)}`,
  },
  [AuditLogEvent.MemberDisconnect]: {
    category: "members",
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

function channelMention(entry) {
  return entry.targetId ? `<#${entry.targetId}>` : "un salon";
}

function overwriteDescribe(entry, verb) {
  const denySend = entry.changes.some((c) => (c.key === "deny" ? String(c.new).includes("SEND_MESSAGES") : false));
  if (!denySend) return null; // pas un verrouillage @everyone : pas assez sûr pour l'afficher comme tel, on se tait
  return `🔒 **Permission de salon ${verb}** — ${channelMention(entry)}${reasonLine(entry)}`;
}

function reasonLine(entry) {
  return entry.reason ? `\n> Raison : ${entry.reason}` : "";
}

/**
 * Poste une entrée de log déjà construite (couleur + description) dans le
 * salon configuré pour `category` (utils/modLogStore.js). Fonction partagée :
 * utilisée par le relais d'audit ci-dessous ET par utils/moderation/actions.js
 * pour les actions de CE bot — une seule implémentation de "comment on
 * envoie une ligne de log", pas deux.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {"moderation"|"members"|"server"|"bots"|"channels"} category
 * @param {{ color: number, description: string, moderatorTag?: string|null }} entry
 */
async function postModerationEntry(client, guildId, category, { color, description, moderatorTag = null }) {
  // "channels" n'est pas une catégorie de salon distincte côté modLogStore
  // (section 17 ne la liste pas séparément) : ses entrées rejoignent "server".
  const routedCategory = category === "channels" ? "server" : category;
  const channelId = getLogChannelId(guildId, routedCategory);
  if (!channelId) return;

  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId) ?? (await guild?.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(description)
    .setFooter({ text: moderatorTag ? `Par ${moderatorTag}` : "Exécuteur inconnu" })
    .setTimestamp();

  // Message permanent, volontairement pas de suppression automatique : c'est
  // tout l'intérêt de ce salon face aux confirmations qui s'effacent d'elles-
  // mêmes ailleurs dans le bot.
  await channel.send({ embeds: [embed] }).catch((err) => {
    console.error(`[moderationLog] échec d'envoi dans le salon de logs (${channelId}) :`, err.message);
  });
}

/**
 * Relaie une entrée du journal d'audit Discord vers le salon de logs
 * configuré (utils/modLogStore.js), si le serveur en a un pour cette
 * catégorie. Ne fait rien silencieusement si le type d'action n'est pas
 * suivi, si l'exécuteur est CE bot (voir l'explication en tête de fichier),
 * ou si l'envoi échoue (salon supprimé, permission retirée...).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildAuditLogsEntry} entry
 */
async function relayAuditLogEntry(client, guild, entry) {
  if (entry.executorId === client.user.id) return; // voir utils/moderation/actions.js

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

  await postModerationEntry(client, guild.id, handler.category, {
    color: handler.color,
    description,
    moderatorTag: entry.executor?.tag || null,
  });

  if (handler.history) {
    let record;
    try {
      record = handler.history(entry);
    } catch (err) {
      console.error("[moderationLog] échec d'enregistrement d'historique :", err);
      return;
    }
    if (!record) return;
    historyStore.record({
      guildId: guild.id,
      moderatorId: entry.executorId || "unknown",
      moderatorTag: entry.executor?.tag || null,
      reason: entry.reason || null,
      source: "audit-log",
      ...record,
    });
  }
}

module.exports = { relayAuditLogEntry, postModerationEntry };
