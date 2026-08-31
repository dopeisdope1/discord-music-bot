const { ChannelType, PermissionFlagsBits } = require("discord.js");
const voiceChannels = require("./voiceChannels");

// Installation en un clic du système de salons vocaux temporaires : deux
// catégories et le salon générateur, plutôt que de laisser créer tout ça à la
// main puis désigner chaque pièce une par une dans le panel.

const VOICE_CATEGORY_NAME = "Salons vocaux";
const TEXT_CATEGORY_NAME = "Panels vocaux";
const HUB_CHANNEL_NAME = "➕ Créer un salon";

/** Réutilise la catégorie déjà enregistrée si elle existe encore, sinon la crée. */
async function ensureCategory(guild, existingId, name, overwrites) {
  const existante = existingId ? guild.channels.cache.get(existingId) : null;
  if (existante) return { channel: existante, created: false };

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
    reason: "Installation des salons vocaux temporaires (&panel > Vocaux)",
  });
  return { channel, created: true };
}

/**
 * Crée ce qui manque et enregistre le tout. Idempotent : relancé, il ne
 * recrée que les pièces réellement absentes (supprimées à la main, par
 * exemple) et laisse le reste en place.
 *
 * @returns {Promise<{ config: object, created: string[] }>} `created` nomme ce
 *   qui vient d'être créé, pour pouvoir le dire au lieu d'un "c'est fait" muet.
 */
async function setupVoiceHub(guild) {
  const config = voiceChannels.getHubConfig(guild.id);
  const created = [];

  const vocale = await ensureCategory(guild, config.voiceCategoryId, VOICE_CATEGORY_NAME);
  if (vocale.created) created.push(`catégorie **${VOICE_CATEGORY_NAME}**`);

  // La catégorie des panneaux hérite du verrou : les salons texte créés dedans
  // n'ont plus à le redéfinir, et un panneau reste non-écrivable même si
  // quelqu'un touche à ses permissions propres.
  const textuelle = await ensureCategory(guild, config.textCategoryId, TEXT_CATEGORY_NAME, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] },
  ]);
  if (textuelle.created) created.push(`catégorie **${TEXT_CATEGORY_NAME}**`);

  let hub = config.hubId ? guild.channels.cache.get(config.hubId) : null;
  if (!hub) {
    hub = await guild.channels.create({
      name: HUB_CHANNEL_NAME,
      type: ChannelType.GuildVoice,
      parent: vocale.channel.id,
      reason: "Salon générateur des vocaux temporaires (&panel > Vocaux)",
    });
    created.push(`salon générateur **${HUB_CHANNEL_NAME}**`);
  }

  const suivant = voiceChannels.setHubConfig(guild.id, {
    hubId: hub.id,
    voiceCategoryId: vocale.channel.id,
    textCategoryId: textuelle.channel.id,
  });
  return { config: suivant, created };
}

module.exports = { setupVoiceHub, VOICE_CATEGORY_NAME, TEXT_CATEGORY_NAME, HUB_CHANNEL_NAME };
