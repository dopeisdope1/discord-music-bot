const { ChannelType, PermissionFlagsBits } = require("discord.js");
const voiceChannels = require("./voiceChannels");
const { buildVoiceControlCard } = require("./serverAdminCommands");

// Construction en un clic de tout ce qu'il faut pour activer les salons
// vocaux temporaires (&panel > Communauté > Vocaux, bouton "Créer la
// configuration") : jusque-là, il fallait créer soi-même un salon vocal puis
// le désigner comme générateur via le sélecteur — correct mais laissé tel
// quel, personne ne devinait qu'il fallait le faire à la main.
//
// Deux catégories plutôt qu'une : la première n'accueille QUE le salon
// générateur (repérable, jamais encombré) ; la seconde reçoit les salons
// créés à la volée ET le salon-panneau partagé, pour qu'ils ne s'entassent
// pas à côté du générateur lui-même.
//
// Le panneau de contrôle est UN SEUL salon texte permanent (pas un salon
// compagnon créé puis détruit à chaque salon vocal) : ses boutons agissent
// sur le salon vocal où la personne est connectée au moment du clic (voir
// utils/serverAdminCommands.js::handleVoiceControlInteraction).

const HUB_CATEGORY_NAME = "🔊 Créer un salon vocal";
const SPAWN_CATEGORY_NAME = "Salons vocaux temporaires";
const HUB_CHANNEL_NAME = "➕ Nouveau salon vocal";
const PANEL_CHANNEL_NAME = "panel-contrôle";

/** @returns {boolean} vrai si un générateur est déjà configuré ET existe toujours sur le serveur. */
function isAlreadyConfigured(guild) {
  const hubId = voiceChannels.getHub(guild.id);
  return Boolean(hubId && guild.channels.cache.has(hubId));
}

/**
 * Crée les deux catégories, le salon générateur et le salon-panneau partagé,
 * puis enregistre le tout. N'écrase jamais une configuration déjà active —
 * voir isAlreadyConfigured, à vérifier par l'appelant avant d'appeler cette
 * fonction.
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
  const panelChannel = await guild.channels.create({
    name: PANEL_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: spawnCategory.id,
    // Invisible par défaut : seule la personne qui possède ACTUELLEMENT un
    // salon vocal temporaire y a accès (voir setPanelAccess dans
    // utils/serverAdminCommands.js, appelé à la création/suppression/
    // transfert d'un salon) — demande explicite, pas un salon public.
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: guild.members.me.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] },
    ],
  });

  voiceChannels.setHub(guild.id, hubChannel.id);
  voiceChannels.setSpawnCategory(guild.id, spawnCategory.id);
  voiceChannels.setPanelChannel(guild.id, panelChannel.id);
  const posted = await panelChannel.send(buildVoiceControlCard()).catch(() => null);
  if (posted) voiceChannels.setPanelMessage(guild.id, posted.id);

  return { hubCategory, spawnCategory, hubChannel, panelChannel };
}

/**
 * Remet à jour la carte statique du salon-panneau — utile après un
 * changement de libellé/contenu (ex : Ouvrir/Fermer inversés) qui ne
 * touche sinon que les NOUVELLES cartes, jamais celle déjà postée. Édite le
 * message existant si possible, sinon en poste un nouveau (message
 * supprimé entre-temps, ou salon-panneau jamais initialisé côté message).
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<boolean>} faux si aucun salon-panneau n'est configuré
 */
async function refreshPanelCard(guild) {
  const { panelChannelId, panelMessageId } = voiceChannels.getHubConfig(guild.id);
  const panelChannel = panelChannelId && guild.channels.cache.get(panelChannelId);
  if (!panelChannel) return false;

  const existing = panelMessageId ? await panelChannel.messages.fetch(panelMessageId).catch(() => null) : null;
  if (existing) {
    await existing.edit(buildVoiceControlCard()).catch(() => {});
    return true;
  }
  const posted = await panelChannel.send(buildVoiceControlCard()).catch(() => null);
  if (posted) voiceChannels.setPanelMessage(guild.id, posted.id);
  return Boolean(posted);
}

module.exports = {
  createVoiceHubSetup,
  refreshPanelCard,
  isAlreadyConfigured,
  HUB_CATEGORY_NAME,
  SPAWN_CATEGORY_NAME,
  HUB_CHANNEL_NAME,
  PANEL_CHANNEL_NAME,
};
