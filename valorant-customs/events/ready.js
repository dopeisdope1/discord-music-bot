/**
 * Bot prêt : nettoyage du stockage, reprise des timers, présence.
 */

const { Events, ActivityType } = require("discord.js");

const config = require("../config");
const store = require("../utils/store");
const { restoreTimers } = require("../utils/warnings");

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    const purged = store.purgeStaleMatches(config.timings.matchTtlMs);
    if (purged) console.log(`[ready] ${purged} partie(s) terminée(s) ou expirée(s) purgée(s).`);

    // Un redémarrage ne doit pas annuler un avertissement en cours.
    await restoreTimers(client);

    client.user.setPresence({
      activities: [{ name: "les customs Valorant", type: ActivityType.Watching }],
      status: "online",
    });

    console.log(`✅ Connecté en tant que ${client.user.tag} — ${client.guilds.cache.size} serveur(s).`);
    if (!config.logChannelId) console.log("ℹ️  LOG_CHANNEL_ID non configuré : les logs restent en console.");
  },
};
