const { ActivityType } = require("discord.js");

/**
 * Renvoie l'activité "écoute Spotify" d'un membre (présence Discord), ou null.
 * Nécessite les intents GuildPresences + GuildMembers.
 * @param {import('discord.js').GuildMember} member
 */
function getSpotifyActivity(member) {
  return (
    member?.presence?.activities?.find(
      (a) => a.type === ActivityType.Listening && a.name === "Spotify"
    ) || null
  );
}

/**
 * Construit une requête de recherche ("titre artiste") à partir d'une
 * activité Spotify.
 */
function spotifyActivityQuery(activity) {
  return [activity.details, activity.state].filter(Boolean).join(" ");
}

module.exports = { getSpotifyActivity, spotifyActivityQuery };
