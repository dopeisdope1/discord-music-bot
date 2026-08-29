/**
 * Bot prêt : nettoyage du stockage, reprise des timers, présence.
 */

const { Events, ActivityType } = require("discord.js");

const config = require("../config");
const store = require("../utils/store");
const { restoreTimers } = require("../utils/warnings");
const settings = require("../utils/settings");
const access = require("../utils/access");

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    // Le propriétaire de l'application Discord (= toi) devient root
    // automatiquement : aucun ID à renseigner, et il ne peut pas se le faire
    // retirer depuis le panneau. BOT_OWNER_IDS reste possible en complément.
    try {
      const application = await client.application.fetch();
      const ownerId = application.owner?.ownerId || application.owner?.id || null;
      access.setApplicationOwner(ownerId);
      if (ownerId) console.log(`👑 Root détecté automatiquement : ${ownerId}`);
    } catch (error) {
      console.error("[ready] Propriétaire de l'application illisible :", error.message);
      if (!access.rootIds().length) {
        console.error("   ⚠️  Aucun root : renseigne BOT_OWNER_IDS dans .env pour ouvrir le panneau.");
      }
    }

    const purged = store.purgeStaleMatches(config.timings.matchTtlMs);
    if (purged) console.log(`[ready] ${purged} partie(s) terminée(s) ou expirée(s) purgée(s).`);

    // Un redémarrage ne doit pas annuler un avertissement en cours.
    await restoreTimers(client);

    client.user.setPresence({
      activities: [{ name: "les customs Valorant", type: ActivityType.Watching }],
      status: "online",
    });

    console.log(`✅ Connecté en tant que ${client.user.tag} — ${client.guilds.cache.size} serveur(s).`);
    if (!settings.get("logChannelId")) console.log("ℹ️  LOG_CHANNEL_ID non configuré : les logs restent en console.");
  },
};
