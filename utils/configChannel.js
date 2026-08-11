const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getRawGuildData: getRawPrefixes, hydrateFromRemote: hydratePrefixes } = require("./prefixStore");
const { getRawGuildData: getRawLogChannels, hydrateFromRemote: hydrateLogChannels } = require("./logStore");
const { getRawGuildData: getRawAntiNuke, hydrateFromRemote: hydrateAntiNuke } = require("./antiNukeStore");
const { getRawGuildData: getRawBlacklist, hydrateFromRemote: hydrateBlacklist } = require("./blacklistStore");
const { getRawGuildData: getRawCommandPermissions, hydrateFromRemote: hydrateCommandPermissions } = require("./commandPermissionStore");
const { getRawGuildData: getRawWelcome, hydrateFromRemote: hydrateWelcome } = require("./welcomeStore");
const { getRawGuildData: getRawWarns, hydrateFromRemote: hydrateWarns } = require("./warnStore");
const { getRawGuildData: getRawTempBans, hydrateFromRemote: hydrateTempBans } = require("./tempBanStore");
const { getRawGuildData: getRawReminders, hydrateFromRemote: hydrateReminders } = require("./reminderStore");
const { getRawGuildData: getRawSupport, hydrateFromRemote: hydrateSupport } = require("./supportStore");
const { getRawGuildData: getRawGiveaways, hydrateFromRemote: hydrateGiveaways } = require("./giveawayStore");

// Le disque du container Railway est réinitialisé à chaque redéploiement, donc
// tout ce qui est écrit dans data/ (préfixes, salons de logs, config antifast,
// blacklist) y disparaît au prochain push. Pour ne jamais perdre la config
// choisie sans dépendre d'un Volume Railway (configuration manuelle sur leur
// dashboard, hors de portée depuis ici), on la sauvegarde AUSSI dans un salon
// Discord caché : Discord, contrairement au disque du bot, n'est jamais
// réinitialisé. Salon partagé entre les bots (Musique+Modération, et
// Sécurité) — chacun n'y écrit QUE les catégories qu'il possède (voir
// CATEGORY_GETTERS/saveGuildConfig), mais lit/restaure TOUTES les catégories
// trouvées, peu importe quel bot les a écrites.
const CONFIG_CHANNEL_NAME = "zinki-config";

// getRawGuildData/hydrateFromRemote par catégorie — un bot n'appelle
// saveGuildConfig qu'avec les clés qu'il modifie réellement (ex: le bot
// Sécurité ne sauvegarde jamais "prefixes", qu'il ne fait que lire).
const CATEGORY_GETTERS = {
  prefixes: getRawPrefixes,
  logChannels: getRawLogChannels,
  antiNuke: getRawAntiNuke,
  blacklist: getRawBlacklist,
  commandPermissions: getRawCommandPermissions,
  welcome: getRawWelcome,
  warns: getRawWarns,
  tempBans: getRawTempBans,
  reminders: getRawReminders,
  support: getRawSupport,
  giveaways: getRawGiveaways,
};
const CATEGORY_HYDRATORS = {
  prefixes: hydratePrefixes,
  logChannels: hydrateLogChannels,
  antiNuke: hydrateAntiNuke,
  blacklist: hydrateBlacklist,
  commandPermissions: hydrateCommandPermissions,
  welcome: hydrateWelcome,
  warns: hydrateWarns,
  tempBans: hydrateTempBans,
  reminders: hydrateReminders,
  support: hydrateSupport,
  giveaways: hydrateGiveaways,
};
const ALL_CATEGORIES = Object.keys(CATEGORY_GETTERS);

// Le "ready" de chaque bot appelle loadGuildConfig(guild) SANS l'attendre (une
// boucle for classique, pas de Promise.all) : le bot commence donc à traiter
// des commandes avant que la restauration ait fini pour chaque serveur. Si
// une commande qui sauvegarde la config tourne dans cette fenêtre,
// saveGuildConfig lirait des valeurs par défaut/vides pour les catégories pas
// encore restaurées et écraserait la vraie config sur Discord avec — c'est ce
// qui faisait revenir le préfixe à sa valeur par défaut après un redéploiement
// qui tombait juste après un test de commande. Map<guildId, Promise> pour que
// saveGuildConfig puisse attendre la restauration en cours avant de composer
// les données à écrire.
const hydrationPromises = new Map();

async function getConfigChannel(guild, { create = false } = {}) {
  let channel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === CONFIG_CHANNEL_NAME
  );
  if (!channel && create) {
    channel = await guild.channels
      .create({
        name: CONFIG_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: "Config interne des bots (préfixes, logs, antifast, blacklist) — généré automatiquement, ne pas supprimer.",
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
        reason: "Salon de configuration interne des bots (persistance entre redéploiements).",
      })
      .catch((err) => {
        console.warn(`[config] Impossible de créer le salon de config sur "${guild.name}" :`, err.message);
        return null;
      });
  }
  return channel;
}

/**
 * Tous les messages de config trouvés dans le salon (un par bot ayant déjà
 * sauvegardé), triés du plus ancien au plus récent (par dernière édition) —
 * pour que lors de la fusion, la valeur la plus fraîche d'une catégorie
 * gagne toujours, même si plusieurs messages contiennent encore la même clé
 * (ex: juste après ce changement, le temps qu'un bot re-sauvegarde et
 * abandonne une clé qu'il ne possède plus).
 */
async function findConfigMessages(channel) {
  const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
  if (!messages) return [];
  return [...messages.values()]
    .filter((m) => m.author.bot && m.content.startsWith("```json"))
    .sort((a, b) => (a.editedTimestamp || a.createdTimestamp) - (b.editedTimestamp || b.createdTimestamp));
}

/**
 * À appeler une fois par serveur au démarrage de chaque bot (voir index.js et
 * security.js, "ready"/"guildCreate") pour recharger la config sauvegardée
 * sur Discord — celle qui survit aux redéploiements Railway — dans le cache
 * local. Fusionne tous les messages de config trouvés (un par bot).
 * @param {import('discord.js').Guild} guild
 */
function loadGuildConfig(guild) {
  const promise = (async () => {
    const channel = await getConfigChannel(guild);
    if (!channel) return;

    const configMessages = await findConfigMessages(channel);
    if (configMessages.length === 0) return;

    try {
      const merged = {};
      for (const m of configMessages) {
        const raw = m.content.replace(/^```json\n/, "").replace(/\n```$/, "");
        Object.assign(merged, JSON.parse(raw));
      }
      for (const key of ALL_CATEGORIES) {
        CATEGORY_HYDRATORS[key](guild.id, merged[key]);
      }
      console.log(`[config] Config restaurée depuis Discord pour "${guild.name}".`);
    } catch (err) {
      console.warn(`[config] Config invalide sur "${guild.name}" :`, err.message);
    }
  })();

  hydrationPromises.set(guild.id, promise);
  return promise;
}

/**
 * À appeler après chaque changement de config pour sauvegarder l'état actuel
 * dans le salon de config Discord, en plus du fichier local. `categories`
 * précise QUELLES catégories ce bot possède/modifie (ex: `["prefixes"]` pour
 * le bot Musique+Modération, `["logChannels"]`/`["antiNuke"]`/`["blacklist"]`
 * pour le bot Sécurité) — écrire uniquement ce que ce bot possède évite qu'un
 * bot écrase la valeur plus fraîche d'un autre avec une copie obsolète.
 * @param {import('discord.js').Guild} guild
 * @param {string[]} categories
 */
async function saveGuildConfig(guild, categories) {
  if (!categories?.length) throw new Error("saveGuildConfig: categories requis (ex: ['prefixes'])");

  // Attend que la restauration initiale (voir loadGuildConfig, appelée au
  // démarrage) soit terminée avant de composer les données à écrire — sinon
  // on risque d'écraser une vraie config avec des valeurs par défaut/vides
  // pas encore restaurées (voir le commentaire sur hydrationPromises).
  const pending = hydrationPromises.get(guild.id);
  if (pending) await pending;

  const data = {};
  for (const key of categories) data[key] = CATEGORY_GETTERS[key](guild.id);
  const content = "```json\n" + JSON.stringify(data, null, 2) + "\n```";

  const channel = await getConfigChannel(guild, { create: true });
  if (!channel) return;

  const configMessages = await findConfigMessages(channel);
  const own = configMessages.find((m) => m.author.id === guild.client.user.id);
  if (own) {
    await own.edit(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  } else {
    await channel.send(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  }
}

/**
 * Attend que la restauration initiale d'un serveur (voir loadGuildConfig)
 * soit terminée, si elle est en cours — ne fait rien si loadGuildConfig n'a
 * jamais été appelée pour ce serveur (ne devrait pas arriver en pratique,
 * appelée pour chaque serveur au "ready"/"guildCreate"). À utiliser avant de
 * LIRE une config potentiellement pas encore restaurée (ex: `.panel`/`=logs`
 * juste après un redémarrage), en plus de saveGuildConfig qui protège déjà
 * les écritures.
 * @param {string} guildId
 */
async function waitForHydration(guildId) {
  const pending = hydrationPromises.get(guildId);
  if (pending) await pending;
}

module.exports = { loadGuildConfig, saveGuildConfig, waitForHydration };
