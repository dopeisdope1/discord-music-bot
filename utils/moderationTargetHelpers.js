const { UsageError, BotError } = require("./modErrors");
const { extractUserId } = require("./argParsing");

async function resolveTargetMember(ctx, raw, usage) {
  const userId = extractUserId(raw);
  if (!userId) throw new UsageError(usage);
  const member = await ctx.guild.members.fetch(userId).catch(() => null);
  if (!member) throw new BotError("Membre introuvable sur ce serveur.");
  return member;
}

// Protège contre une action sur le propriétaire du serveur, sur quelqu'un
// dont le rôle le plus haut dépasse celui de l'auteur (sauf super_sys), ou
// sur quelqu'un que le bot lui-même ne peut pas toucher.
function assertCanModerate(ctx, target) {
  if (target.id === ctx.guild.ownerId) {
    throw new BotError("Impossible d'agir sur le propriétaire du serveur.");
  }

  if (!ctx.isSuperSys && ctx.member.id !== ctx.guild.ownerId) {
    if (ctx.member.roles.highest.position <= target.roles.highest.position) {
      throw new BotError("Ce membre a un rôle égal ou supérieur au tien.");
    }
  }

  if (ctx.guild.members.me.roles.highest.position <= target.roles.highest.position) {
    throw new BotError("Mon rôle est trop bas pour agir sur ce membre.");
  }
}

module.exports = { resolveTargetMember, assertCanModerate };
