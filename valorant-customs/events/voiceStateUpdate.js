/**
 * Réactivité du système anti-absent : dès qu'un joueur averti se connecte au
 * bon salon vocal, son avertissement est annulé sans attendre la fin du timer.
 */

const { Events } = require("discord.js");

const config = require("../config");
const store = require("../utils/store");
const { cancelWarning } = require("../utils/warnings");

module.exports = {
  name: Events.VoiceStateUpdate,

  async execute(oldState, newState) {
    const channelId = newState.channelId;
    if (!channelId || channelId === oldState.channelId) return; // déconnexion ou mute

    const userId = newState.id;
    const client = newState.client;

    for (const match of store.allMatches()) {
      if (match.guildId !== newState.guild.id || match.status === "ended") continue;

      const warning = match.warnings?.[userId];
      if (!warning) continue;

      // Salon d'équipe existant : il faut être dedans. Sinon (partie pas encore
      // lancée), n'importe quel vocal vaut présence — même règle que le timer.
      const teamChannelId = match.voice?.[warning.teamNo];
      const present = teamChannelId ? channelId === teamChannelId : config.behaviour.warnAcceptAnyVoice;
      if (!present) continue;

      await cancelWarning(client, match, userId, {
        reason: `<@${userId}> a rejoint le vocal à temps ${config.emojis.warn}➜ ✅ avertissement levé.`,
      });
    }
  },
};
