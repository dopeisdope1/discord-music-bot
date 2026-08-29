/**
 * Réactivité du système anti-absent : dès qu'un joueur averti se connecte au
 * bon salon vocal, son avertissement est annulé sans attendre la fin du timer.
 */

const { Events } = require("discord.js");

const config = require("../config");
const store = require("../utils/store");
const { cancelWarning } = require("../utils/warnings");
const automation = require("../utils/automation");
const settings = require("../utils/settings");

module.exports = {
  name: Events.VoiceStateUpdate,

  async execute(oldState, newState) {
    const channelId = newState.channelId;
    const userId = newState.id;
    const client = newState.client;
    const guild = newState.guild || oldState.guild;

    // ---- Départ d'un salon d'équipe : fin automatique si tout se vide ----
    if (oldState.channelId && oldState.channelId !== channelId) {
      for (const match of store.allMatches()) {
        if (match.guildId !== guild.id || match.status !== "live") continue;
        if (match.voice?.[1] !== oldState.channelId && match.voice?.[2] !== oldState.channelId) continue;
        await automation.checkEmptyChannels(client, guild, match);
      }
    }

    if (!channelId || channelId === oldState.channelId) return; // déconnexion ou mute

    // ---- Arrivée dans un salon d'équipe : on annule la fin programmée ----
    for (const match of store.allMatches()) {
      if (match.guildId !== guild.id || match.status !== "live") continue;
      if (match.voice?.[1] === channelId || match.voice?.[2] === channelId) automation.cancelAutoEnd(match.id);
    }

    for (const match of store.allMatches()) {
      if (match.guildId !== newState.guild.id || match.status === "ended") continue;

      const warning = match.warnings?.[userId];
      if (!warning) continue;

      // Salon d'équipe existant : il faut être dedans. Sinon (partie pas encore
      // lancée), n'importe quel vocal vaut présence — même règle que le timer.
      const teamChannelId = match.voice?.[warning.teamNo];
      const present = teamChannelId ? channelId === teamChannelId : settings.get("warnAcceptAnyVoice");
      if (!present) continue;

      await cancelWarning(client, match, userId, {
        reason: `<@${userId}> a rejoint le vocal à temps ${config.emojis.warn}➜ ✅ avertissement levé.`,
      });
    }
  },
};
