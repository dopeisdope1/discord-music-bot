const { ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { getAllLogChannels, setLogChannelId, CATEGORY_LABELS } = require("./modLogStore");
const { createLogChannelsAutomatically } = require("./logChannels");

// Équivalents texte de &panel > Logs. Ils écrivent dans le MÊME store
// (utils/modLogStore.js) et appellent la MÊME création automatique
// (utils/logChannels.js) que les boutons du panel : deux façons de faire la
// même chose, jamais deux comportements.

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/**
 * Une commande par catégorie du store, plutôt qu'un `&log <catégorie>`
 * générique : c'est la forme documentée au catalogue (`&modlog on`), et elle
 * se tape plus court que la version à deux arguments.
 */
const COMMAND_TO_CATEGORY = {
  modlog: "moderation",
  memberlog: "members",
  rolelog: "roles",
  channellog: "channels",
  voicelog: "voice",
  serverlog: "server",
  botlog: "bots",
  messagelog: "messages",
};

/** Salon visé : mention, ID brut, ou le salon courant. */
function resolveChannel(message, args) {
  const mentioned = message.mentions.channels?.first();
  if (mentioned) return mentioned;

  const rawId = args.find((a) => /^\d{15,25}$/.test(a));
  if (rawId) return message.guild.channels.cache.get(rawId) || null;
  return message.channel;
}

/** Corps commun de &modlog/&messagelog/&voicelog/... — `on [salon]` ou `off`. */
async function setCategoryLog(client, message, args, category) {
  if (!can(message.member, "logs.manage")) return;

  const label = CATEGORY_LABELS[category];
  const sub = (args[0] || "").toLowerCase();

  if (sub === "off") {
    setLogChannelId(message.guild.id, category, null);
    return reply(message, "success", `Logs **${label}** désactivés.`);
  }

  if (sub !== "on") {
    const current = getAllLogChannels(message.guild.id)[category];
    return reply(
      message,
      "info",
      [
        `**${label}** : ${current ? `<#${current}>` : "*désactivé*"}`,
        "",
        `\`${message.content.trim().split(/\s+/)[0]} on [salon]\` pour activer, \`off\` pour désactiver.`,
      ].join("\n")
    );
  }

  const channel = resolveChannel(message, args.slice(1));
  if (!channel) return reply(message, "error", "Salon introuvable : donne une mention ou un identifiant valide.");
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return reply(message, "error", "Les logs ne peuvent être envoyés que dans un salon écrit.");
  }
  // Un salon où le bot ne peut pas écrire ferait disparaître les logs en
  // silence : autant le refuser tout de suite.
  if (!channel.permissionsFor(message.guild.members.me)?.has("SendMessages")) {
    return reply(message, "error", `Le bot ne peut pas écrire dans ${channel}.`);
  }

  setLogChannelId(message.guild.id, category, channel.id);
  return reply(message, "success", `Logs **${label}** envoyés dans ${channel}.`);
}

const handlers = {
  /** &settings — résumé des salons de logs configurés. */
  async settings(client, message) {
    if (!can(message.member, "logs.manage") && !can(message.member, "logs.view")) return;
    const channels = getAllLogChannels(message.guild.id);
    const lines = Object.entries(channels).map(([category, channelId]) => {
      const command = Object.keys(COMMAND_TO_CATEGORY).find((c) => COMMAND_TO_CATEGORY[c] === category);
      return `> **${CATEGORY_LABELS[category]}** (\`${command}\`) : ${channelId ? `<#${channelId}>` : "*désactivé*"}`;
    });
    const actifs = Object.values(channels).filter(Boolean).length;
    await reply(message, "info", [`**${actifs} catégorie(s) sur ${lines.length}** configurée(s).`, "", ...lines].join("\n"));
  },

  /** &autoconfiglog — même action que le bouton de &panel > Logs. */
  async autoconfiglog(client, message) {
    if (!can(message.member, "logs.manage")) return;
    const { created } = await createLogChannelsAutomatically(message.guild).catch((err) => {
      console.error("[logCommands] création automatique :", err);
      return null;
    }) || {};

    if (created === undefined) return reply(message, "error", "Discord a refusé la création des salons (permissions du bot ?).");
    if (!created.length) return reply(message, "info", "Toutes les catégories ont déjà un salon de logs existant.");
    await reply(
      message,
      "success",
      [`**${created.length} salon(s) créé(s)** :`, ...created.map((c) => `> ${CATEGORY_LABELS[c.category]} → <#${c.channel.id}>`)].join("\n")
    );
  },
};

for (const [command, category] of Object.entries(COMMAND_TO_CATEGORY)) {
  handlers[command] = (client, message, args) => setCategoryLog(client, message, args, category);
}

module.exports = { logHandlers: handlers, COMMAND_TO_CATEGORY };
