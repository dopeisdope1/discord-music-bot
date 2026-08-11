const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");

/**
 * Renomme le bot dans le serveur et poste un message de présentation — sert
 * à distinguer les bots entre eux dans la liste des membres/messages plutôt
 * que de se fier au seul nom d'utilisateur Discord. Déclenché à la demande
 * via la commande `identify` de chaque bot (pas automatique au démarrage,
 * pour ne pas reposter à chaque redéploiement Railway).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {{ emoji: string, name: string, description: string }} info
 * @returns {Promise<boolean>} true si le message de présentation a pu être envoyé
 */
async function announceIdentity(client, guild, { emoji, name, description }) {
  const me = guild.members.me;
  if (me?.manageable !== false) {
    await me?.setNickname(`${emoji} ${name}`, "Identification du bot").catch(() => {});
  }

  const canPost = (channel) =>
    channel.type === ChannelType.GuildText && channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages);

  const channel = (guild.systemChannel && canPost(guild.systemChannel) ? guild.systemChannel : null) || guild.channels.cache.find(canPost);
  if (!channel) return false;

  await channel
    .send({ embeds: [buildStatusEmbed("info", description, { title: `${emoji} ${name}` })] })
    .catch(() => {});
  return true;
}

module.exports = { announceIdentity };
