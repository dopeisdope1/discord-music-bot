const { ActivityType } = require("discord.js");

/**
 * Cherche une activité "écoute Spotify" dans une liste d'activités de présence.
 */
function findSpotifyActivity(activities) {
  return activities?.find((a) => a.type === ActivityType.Listening && a.name === "Spotify") || null;
}

/**
 * Renvoie l'activité "écoute Spotify" d'un membre (présence Discord), ou null.
 * Nécessite les intents GuildPresences + GuildMembers.
 * @param {import('discord.js').GuildMember} member
 */
function getSpotifyActivity(member) {
  return findSpotifyActivity(member?.presence?.activities);
}

/**
 * Construit une requête de recherche ("titre artiste") à partir d'une
 * activité Spotify.
 */
function spotifyActivityQuery(activity) {
  return [activity.details, activity.state].filter(Boolean).join(" ");
}

/**
 * Position actuelle (en ms) dans le morceau, déduite de l'horodatage de début
 * fourni par la présence Spotify.
 */
function spotifyActivityElapsedMs(activity) {
  const start = activity?.timestamps?.start;
  if (!start) return 0;
  return Math.max(0, Date.now() - start);
}

module.exports = { findSpotifyActivity, getSpotifyActivity, spotifyActivityQuery, spotifyActivityElapsedMs };
