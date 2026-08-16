const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getRawGuildData: getRawPrefixes, hydrateFromRemote: hydratePrefixes } = require("./prefixStore");
const { getRawGuildData: getRawLogChannels, hydrateFromRemote: hydrateLogChannels } = require("./logStore");
const { getRawGuildData: getRawWelcome, hydrateFromRemote: hydrateWelcome } = require("./welcomeStore");
// Système de modération/panel —
// remplace l'ancien commandPermissionStore/permTierStore.
const { getRawGuildData: getRawPermissions, hydrateFromRemote: hydratePermissions } = require("./permissionsStore");
const { getRawGuildData: getRawChannelBlacklist, hydrateFromRemote: hydrateChannelBlacklist } = require("./channelBlacklistStore");
const { getRawGuildData: getRawMute, hydrateFromRemote: hydrateMute } = require("./muteStore");
const { getRawGuildData: getRawAddroleConfig, hydrateFromRemote: hydrateAddroleConfig } = require("./addroleConfigStore");
const { getRawGuildData: getRawAntiraidConfig, hydrateFromRemote: hydrateAntiraidConfig } = require("./antiraidConfigStore");
const { getRawGuildData: getRawRoleBlacklist, hydrateFromRemote: hydrateRoleBlacklist } = require("./roleBlacklistStore");
// (Les dates Nitro ne sont PAS ici : elles sont liées au compte et pas au
// serveur, donc stockées globalement dans DATA_DIR. Elles ne survivent à un
// redéploiement que si DATA_DIR pointe vers un Volume Railway monté.
// Voir utils/nitroStore.js.)

// Le disque du container Railway est réinitialisé à chaque redéploiement, donc
// tout ce qui est écrit dans data/ (préfixes, logs, permissions, paliers...)
// y disparaît au prochain push. Pour ne jamais perdre la config choisie sans
// dépendre d'un Volume Railway (configuration manuelle sur leur dashboard,
// hors de portée depuis ici), on la sauvegarde AUSSI dans un salon Discord
// caché : Discord, contrairement au disque du bot, n'est jamais réinitialisé.
const CONFIG_CHANNEL_NAME = "zinki-config";

// getRawGuildData/hydrateFromRemote par catégorie.
const CATEGORY_GETTERS = {
  prefixes: getRawPrefixes,
  logChannels: getRawLogChannels,
  welcome: getRawWelcome,
  permissions: getRawPermissions,
  channelBlacklist: getRawChannelBlacklist,
  mute: getRawMute,
  addroleConfig: getRawAddroleConfig,
  antiraidConfig: getRawAntiraidConfig,
  roleBlacklist: getRawRoleBlacklist,
};
const CATEGORY_HYDRATORS = {
  prefixes: hydratePrefixes,
  logChannels: hydrateLogChannels,
  welcome: hydrateWelcome,
  permissions: hydratePermissions,
  channelBlacklist: hydrateChannelBlacklist,
  mute: hydrateMute,
  addroleConfig: hydrateAddroleConfig,
  antiraidConfig: hydrateAntiraidConfig,
  roleBlacklist: hydrateRoleBlacklist,
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

/**
 * TOUS les salons nommés "zinki-config" du serveur, triés du plus ancien au
 * plus récent. Il ne devrait normalement en exister qu'un seul, mais des
 * doublons ont pu être créés par le passé (ex: si `guild.channels.cache`
 * n'était pas encore complètement synchronisé au moment d'un appel avec
 * `create: true`, un second salon identique était créé sans que le premier
 * soit revu) — chercher/lire TOUS les candidats plutôt que le premier
 * trouvé évite de tomber au hasard sur un doublon vide selon l'ordre du
 * cache à chaque redémarrage.
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').TextChannel[]}
 */
function findAllConfigChannels(guild) {
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText && c.name === CONFIG_CHANNEL_NAME)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function createConfigChannel(guild) {
  return guild.channels
    .create({
      name: CONFIG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      topic: "Config interne du bot (préfixes, logs, permissions, paliers...) — généré automatiquement, ne pas supprimer.",
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
      reason: "Salon de configuration interne du bot (persistance entre redéploiements).",
    })
    .catch((err) => {
      console.warn(`[config] Impossible de créer le salon de config sur "${guild.name}" :`, err.message);
      return null;
    });
}

/**
 * Messages de config valides d'un salon (JSON entre balises), triés du plus
 * ancien au plus récent (par dernière édition). Réessaie automatiquement si
 * le résultat est vide : juste après une reconnexion, le fetch peut échouer
 * ou revenir vide en silence sans que le salon soit réellement vide.
 * @param {import('discord.js').TextChannel} channel
 * @param {number} [retriesLeft]
 */
async function fetchConfigMessages(channel, retriesLeft = 2) {
  const messages = await channel.messages.fetch({ limit: 10 }).catch((err) => {
    console.warn(`[config] Échec de la récupération des messages de "${channel.name}" :`, err.message);
    return null;
  });
  const found = messages
    ? [...messages.values()].filter((m) => m.author.bot && m.content.startsWith("```json"))
    : [];

  if (found.length > 0 || retriesLeft <= 0) return found;

  await new Promise((resolve) => setTimeout(resolve, 2000));
  return fetchConfigMessages(channel, retriesLeft - 1);
}

/**
 * Tous les messages de config valides trouvés, tous salons "zinki-config"
 * confondus (voir findAllConfigChannels), triés du plus ancien au plus
 * récent — pour que lors de la fusion, la valeur la plus fraîche d'une
 * catégorie gagne toujours, même répartie entre plusieurs salons/messages.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ channels: import('discord.js').TextChannel[], messages: import('discord.js').Message[] }>}
 */
async function collectConfigMessages(guild) {
  const channels = findAllConfigChannels(guild);
  const perChannel = await Promise.all(channels.map((c) => fetchConfigMessages(c)));
  const messages = perChannel
    .flat()
    .sort((a, b) => (a.editedTimestamp || a.createdTimestamp) - (b.editedTimestamp || b.createdTimestamp));
  return { channels, messages };
}

/**
 * À appeler une fois par serveur au démarrage du bot ("ready"/"guildCreate")
 * pour recharger la config sauvegardée sur Discord — celle qui survit aux
 * redéploiements Railway — dans le cache local. Fusionne tous les messages
 * de config trouvés, tous salons "zinki-config" confondus.
 * @param {import('discord.js').Guild} guild
 */
function loadGuildConfig(guild) {
  const promise = (async () => {
    const { channels, messages } = await collectConfigMessages(guild);

    if (channels.length === 0) {
      console.warn(`[config] Aucun salon "${CONFIG_CHANNEL_NAME}" sur "${guild.name}" — config par défaut.`);
      return;
    }
    if (messages.length === 0) {
      console.warn(
        `[config] ${channels.length} salon(s) "${CONFIG_CHANNEL_NAME}" trouvé(s) mais vide(s) sur "${guild.name}" — config par défaut.`
      );
      return;
    }

    try {
      const merged = {};
      for (const m of messages) {
        const raw = m.content.replace(/^```json\n/, "").replace(/\n```$/, "");
        Object.assign(merged, JSON.parse(raw));
      }
      for (const key of ALL_CATEGORIES) {
        CATEGORY_HYDRATORS[key](guild.id, merged[key]);
      }
      console.log(
        `[config] Config restaurée depuis Discord pour "${guild.name}" (${messages.length} message(s) sur ${channels.length} salon(s) : ${messages
          .map((m) => `${m.author.tag}${m.editedTimestamp ? " édité" : ""}`)
          .join(", ")}).`
      );
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
 * documente quelles catégories viennent de changer (utile pour lire le code
 * aux call sites), mais la sauvegarde écrit TOUJOURS l'état complet de
 * toutes les catégories (voir ALL_CATEGORIES) — un seul bot (Musique)
 * possède désormais toute la config. Consolide aussi au passage tous les
 * salons "zinki-config" en un seul (voir findAllConfigChannels) et supprime
 * tout message qui ne vient pas de ce bot (ancienne identité de bot
 * supprimée) — sans ça, un doublon ou un message figé pouvait regagner la
 * fusion au prochain redémarrage et faire "revenir en arrière" la config.
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
  for (const key of ALL_CATEGORIES) data[key] = CATEGORY_GETTERS[key](guild.id);
  const content = "```json\n" + JSON.stringify(data, null, 2) + "\n```";

  let channels = findAllConfigChannels(guild);
  if (channels.length === 0) {
    const created = await createConfigChannel(guild);
    if (!created) return;
    channels = [created];
  }

  // Le plus ancien salon est le canonique (le plus susceptible d'être
  // l'original, pas un doublon créé par erreur plus tard) : on y écrit,
  // et on supprime tous les autres salons "zinki-config" en trop.
  const [canonical, ...duplicates] = channels;

  const configMessages = await fetchConfigMessages(canonical);
  const own = configMessages.find((m) => m.author.id === guild.client.user.id);
  const stale = configMessages.filter((m) => m.author.id !== guild.client.user.id);

  if (own) {
    await own.edit(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  } else {
    await canonical.send(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  }

  for (const msg of stale) {
    await msg.delete().catch((err) => console.warn("[config] Échec du nettoyage d'un ancien message de config :", err.message));
  }

  for (const dup of duplicates) {
    await dup.delete("Doublon du salon de config interne").catch((err) => console.warn("[config] Échec de la suppression d'un salon de config en double :", err.message));
  }
}

/**
 * Attend que la restauration initiale d'un serveur (voir loadGuildConfig)
 * soit terminée, si elle est en cours — ne fait rien si loadGuildConfig n'a
 * jamais été appelée pour ce serveur (ne devrait pas arriver en pratique,
 * appelée pour chaque serveur au "ready"/"guildCreate"). À utiliser avant de
 * LIRE une config potentiellement pas encore restaurée (ex: `&panel` juste
 * après un redémarrage), en plus de saveGuildConfig qui protège déjà les
 * écritures.
 * @param {string} guildId
 */
async function waitForHydration(guildId) {
  const pending = hydrationPromises.get(guildId);
  if (pending) await pending;
}

module.exports = { loadGuildConfig, saveGuildConfig, waitForHydration };
