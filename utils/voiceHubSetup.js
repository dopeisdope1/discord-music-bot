const { ChannelType } = require("discord.js");
const voiceChannels = require("./voiceChannels");

// Construction en un clic de tout ce qu'il faut pour activer les salons
// vocaux temporaires (&panel > Communauté > Vocaux, bouton "Créer la
// configuration") : jusque-là, il fallait créer soi-même un salon vocal puis
// le désigner comme générateur via le sélecteur — correct mais laissé tel
// quel, personne ne devinait qu'il fallait le faire à la main.
//
// Deux catégories plutôt qu'une : la première n'accueille QUE le salon
// générateur (repérable, jamais encombré) ; la seconde reçoit les salons
// créés à la volée (vocal + texte du panneau), pour qu'ils ne s'entassent
// pas à côté du générateur lui-même.

const HUB_CATEGORY_NAME = "🔊 Créer un salon vocal";
const SPAWN_CATEGORY_NAME = "Salons vocaux temporaires";
const HUB_CHANNEL_NAME = "➕ Nouveau salon vocal";

/** @returns {boolean} vrai si un générateur est déjà configuré ET existe toujours sur le serveur. */
function isAlreadyConfigured(guild) {
  const hubId = voiceChannels.getHub(guild.id);
  return Boolean(hubId && guild.channels.cache.has(hubId));
}

/**
 * Crée les deux catégories et le salon générateur, puis enregistre le tout.
 * N'écrase jamais une configuration déjà active — voir isAlreadyConfigured,
 * à vérifier par l'appelant avant d'appeler cette fonction.
 * @param {import('discord.js').Guild} guild
 */
async function createVoiceHubSetup(guild) {
  const hubCategory = await guild.channels.create({ name: HUB_CATEGORY_NAME, type: ChannelType.GuildCategory });
  const spawnCategory = await guild.channels.create({ name: SPAWN_CATEGORY_NAME, type: ChannelType.GuildCategory });
  const hubChannel = await guild.channels.create({
    name: HUB_CHANNEL_NAME,
    type: ChannelType.GuildVoice,
    parent: hubCategory.id,
  });

  voiceChannels.setHub(guild.id, hubChannel.id);
  voiceChannels.setSpawnCategory(guild.id, spawnCategory.id);

  return { hubCategory, spawnCategory, hubChannel };
}

module.exports = { createVoiceHubSetup, isAlreadyConfigured, HUB_CATEGORY_NAME, SPAWN_CATEGORY_NAME, HUB_CHANNEL_NAME };
