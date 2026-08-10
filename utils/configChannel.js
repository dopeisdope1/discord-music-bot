const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getRawGuildData: getRawPrefixes, hydrateFromRemote: hydratePrefixes } = require("./prefixStore");
const { getRawGuildData: getRawLogChannels, hydrateFromRemote: hydrateLogChannels } = require("./logStore");
const {
  getRawGuildData: getRawPermissionCategories,
  hydrateFromRemote: hydratePermissionCategories,
} = require("./permissionCategoryStore");
const {
  getRawGuildData: getRawAntiNuke,
  hydrateFromRemote: hydrateAntiNuke,
} = require("./antiNukeStore");

// Le disque du container Railway est réinitialisé à chaque redéploiement, donc
// tout ce qui est écrit dans data/ (préfixes, salons de logs) y disparaît au
// prochain push. Pour ne jamais perdre la config choisie via `.panel` sans
// dépendre d'un Volume Railway (configuration manuelle sur leur dashboard,
// hors de portée depuis ici), on la sauvegarde AUSSI dans un salon Discord
// caché : Discord, contrairement au disque du bot, n'est jamais réinitialisé.
const CONFIG_CHANNEL_NAME = "zinki-config";

async function getConfigChannel(guild, { create = false } = {}) {
  let channel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === CONFIG_CHANNEL_NAME
  );
  if (!channel && create) {
    channel = await guild.channels
      .create({
        name: CONFIG_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: "Config interne du bot (préfixes, salons de logs) — généré automatiquement, ne pas supprimer.",
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
        reason: "Salon de configuration interne du bot (persistance entre redéploiements).",
      })
      .catch((err) => {
        console.warn(`[config] Impossible de créer le salon de config sur "${guild.name}" :`, err.message);
        return null;
      });
  }
  return channel;
}

async function findConfigMessage(channel) {
  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  return (
    messages?.find((m) => m.author.id === channel.client.user.id && m.content.startsWith("```json")) || null
  );
}

/**
 * À appeler une fois par serveur au démarrage du bot (voir index.js "ready"
 * et "guildCreate") pour recharger la config sauvegardée sur Discord — celle
 * qui survit aux redéploiements Railway — dans le cache local.
 * @param {import('discord.js').Guild} guild
 */
async function loadGuildConfig(guild) {
  const channel = await getConfigChannel(guild);
  if (!channel) return;

  const message = await findConfigMessage(channel);
  if (!message) return;

  try {
    const raw = message.content.replace(/^```json\n/, "").replace(/\n```$/, "");
    const data = JSON.parse(raw);
    hydratePrefixes(guild.id, data.prefixes);
    hydrateLogChannels(guild.id, data.logChannels);
    hydratePermissionCategories(guild.id, data.permissionCategories);
    hydrateAntiNuke(guild.id, data.antiNuke);
    console.log(`[config] Config restaurée depuis Discord pour "${guild.name}".`);
  } catch (err) {
    console.warn(`[config] Config invalide sur "${guild.name}" :`, err.message);
  }
}

/**
 * À appeler après chaque changement fait via `.panel` (préfixe ou salon de
 * logs) pour sauvegarder l'état actuel dans le salon de config Discord, en
 * plus du fichier local.
 * @param {import('discord.js').Guild} guild
 */
async function saveGuildConfig(guild) {
  const data = {
    prefixes: getRawPrefixes(guild.id),
    logChannels: getRawLogChannels(guild.id),
    permissionCategories: getRawPermissionCategories(guild.id),
    antiNuke: getRawAntiNuke(guild.id),
  };
  const content = "```json\n" + JSON.stringify(data, null, 2) + "\n```";

  const channel = await getConfigChannel(guild, { create: true });
  if (!channel) return;

  const message = await findConfigMessage(channel);
  if (message) {
    await message.edit(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  } else {
    await channel.send(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  }
}

module.exports = { loadGuildConfig, saveGuildConfig };
