const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { BotError, UsageError } = require("./modErrors");
const { extractUserId, extractChannelId } = require("./argParsing");

/**
 * Membre ciblé, qui DOIT être connecté à un salon vocal.
 * @param {object} ctx
 * @param {string} raw mention ou id
 * @param {string} usage
 */
async function resolveVoiceMember(ctx, raw, usage) {
  const userId = extractUserId(raw);
  if (!userId) throw new UsageError(usage);

  const member = await ctx.guild.members.fetch(userId).catch(() => null);
  if (!member) throw new BotError("Membre introuvable sur ce serveur.");
  if (!member.voice.channel) throw new BotError(`**${member.user.tag}** n'est dans aucun salon vocal.`);

  return member;
}

/**
 * Salon vocal désigné par une mention/un id/un nom. Sans argument, retombe
 * sur le salon vocal de l'auteur de la commande.
 */
async function resolveVoiceChannel(ctx, raw, { fallbackToAuthor = false } = {}) {
  if (!raw) {
    if (fallbackToAuthor && ctx.member.voice.channel) return ctx.member.voice.channel;
    throw new BotError("Précise un salon vocal (mention, id ou nom), ou connecte-toi à un salon vocal.");
  }

  const id = extractChannelId(raw);
  const channel = id
    ? await ctx.guild.channels.fetch(id).catch(() => null)
    : ctx.guild.channels.cache.find((c) => c.isVoiceBased() && c.name.toLowerCase() === raw.toLowerCase());

  if (!channel) throw new BotError("Salon vocal introuvable.");
  if (!channel.isVoiceBased()) throw new BotError(`${channel} n'est pas un salon vocal.`);

  return channel;
}

/** Vérifie que le bot a bien la permission Discord nécessaire. */
function assertBotCan(ctx, flag, label) {
  if (!ctx.guild.members.me.permissions.has(flag)) {
    throw new BotError(`Il me manque la permission **${label}**.`);
  }
}

/**
 * Garde-fous de hiérarchie, comme pour la modération texte : pas le
 * propriétaire, pas quelqu'un au-dessus de soi (sauf super_sys), pas
 * quelqu'un au-dessus du bot.
 */
function assertCanActOn(ctx, target) {
  if (target.id === ctx.guild.ownerId) throw new BotError("Impossible d'agir sur le propriétaire du serveur.");

  if (!ctx.isSuperSys && ctx.member.id !== ctx.guild.ownerId) {
    if (ctx.member.roles.highest.position <= target.roles.highest.position) {
      throw new BotError("Ce membre a un rôle égal ou supérieur au tien.");
    }
  }

  if (ctx.guild.members.me.roles.highest.position <= target.roles.highest.position) {
    throw new BotError("Mon rôle est trop bas pour agir sur ce membre.");
  }
}

module.exports = {
  resolveVoiceMember,
  resolveVoiceChannel,
  assertBotCan,
  assertCanActOn,
  ChannelType,
  PermissionFlagsBits,
};
