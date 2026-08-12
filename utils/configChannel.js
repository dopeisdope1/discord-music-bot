const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getRawGuildData: getRawPrefixes, hydrateFromRemote: hydratePrefixes } = require("./prefixStore");
const { getRawGuildData: getRawLogChannels, hydrateFromRemote: hydrateLogChannels } = require("./logStore");
const { getRawGuildData: getRawCommandPermissions, hydrateFromRemote: hydrateCommandPermissions } = require("./commandPermissionStore");
const { getRawGuildData: getRawWelcome, hydrateFromRemote: hydrateWelcome } = require("./welcomeStore");
const { getRawGuildData: getRawPermTiers, hydrateFromRemote: hydratePermTiers } = require("./permTierStore");

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
  commandPermissions: getRawCommandPermissions,
  welcome: getRawWelcome,
  permTiers: getRawPermTiers,
};
const CATEGORY_HYDRATORS = {
  prefixes: hydratePrefixes,
  logChannels: hydrateLogChannels,
  commandPermissions: hydrateCommandPermissions,
  welcome: hydrateWelcome,
  permTiers: hydratePermTiers,
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
 *
 * Réessaie automatiquement si le résultat est vide : juste après une
 * reconnexion, le fetch peut échouer ou revenir vide en silence (cache/
 * permissions pas encore complètement synchronisés côté Discord) sans que
 * le salon soit réellement vide — sans nouvelle tentative, ça se lisait à
 * tort comme "plus de config du tout" et risquait d'écraser la vraie
 * sauvegarde au prochain saveGuildConfig.
 * @param {import('discord.js').TextChannel} channel
 * @param {number} [retriesLeft]
 */
async function findConfigMessages(channel, retriesLeft = 3) {
  const messages = await channel.messages.fetch({ limit: 10 }).catch((err) => {
    console.warn(`[config] Échec de la récupération des messages de "${channel.name}" :`, err.message);
    return null;
  });
  const found = messages
    ? [...messages.values()]
        .filter((m) => m.author.bot && m.content.startsWith("```json"))
        .sort((a, b) => (a.editedTimestamp || a.createdTimestamp) - (b.editedTimestamp || b.createdTimestamp))
    : [];

  if (found.length > 0 || retriesLeft <= 0) return found;

  await new Promise((resolve) => setTimeout(resolve, 2000));
  return findConfigMessages(channel, retriesLeft - 1);
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
    if (!channel) {
      console.warn(`[config] Salon "${CONFIG_CHANNEL_NAME}" introuvable sur "${guild.name}" — config par défaut.`);
      return;
    }

    const configMessages = await findConfigMessages(channel);
    if (configMessages.length === 0) {
      console.warn(`[config] Salon "${CONFIG_CHANNEL_NAME}" trouvé mais vide sur "${guild.name}" — config par défaut.`);
      return;
    }

    try {
      const merged = {};
      for (const m of configMessages) {
        const raw = m.content.replace(/^```json\n/, "").replace(/\n```$/, "");
        Object.assign(merged, JSON.parse(raw));
      }
      for (const key of ALL_CATEGORIES) {
        CATEGORY_HYDRATORS[key](guild.id, merged[key]);
      }
      console.log(
        `[config] Config restaurée depuis Discord pour "${guild.name}" (${configMessages.length} message(s) : ${configMessages
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
 * possède désormais toute la config, contrairement à l'époque multi-bots où
 * chacun n'écrivait que ce qu'il possédait. Nettoie aussi au passage tout
 * message de config laissé par d'anciennes identités de bot (Gestion/Logs/
 * Security, supprimés) : sans ça, leur contenu figé pouvait regagner la
 * fusion au prochain redémarrage si son horodatage se retrouvait plus
 * récent, faisant "revenir en arrière" un préfixe (ou une autre config)
 * pourtant changé depuis sur ce bot.
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

  const channel = await getConfigChannel(guild, { create: true });
  if (!channel) return;

  const configMessages = await findConfigMessages(channel);
  const own = configMessages.find((m) => m.author.id === guild.client.user.id);
  const stale = configMessages.filter((m) => m.author.id !== guild.client.user.id);

  if (own) {
    await own.edit(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  } else {
    await channel.send(content).catch((err) => console.warn("[config] Échec de la sauvegarde :", err.message));
  }

  for (const msg of stale) {
    await msg.delete().catch((err) => console.warn("[config] Échec du nettoyage d'un ancien message de config :", err.message));
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
