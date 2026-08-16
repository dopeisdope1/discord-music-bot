const { getPrefixes } = require("./prefixStore");
const { waitForHydration } = require("./configChannel");
const { loadAllCommands } = require("./modCommandLoader");
const { buildContext } = require("./modCommandContext");
const { checkAccess, effectiveLevel, isDisabled } = require("./accessControl");
const { LEVEL } = require("./permLevels");
const cooldowns = require("./modCooldowns");
const { BotError, UsageError, PermissionError } = require("./modErrors");
const channelBlacklistStore = require("./channelBlacklistStore");
const { canRunCommand } = require("./voiceAccess");
const antiraidDetector = require("./antiraidDetector");
const { addRoleDirect, delRoleDirect } = require("./rolePanels");

// Confirmations effacées d'elles-mêmes, par catégorie de commande. Elles
// n'apprennent rien une fois lues : le résultat est visible dans le salon
// (verrouillé, renommé, message supprimé...), donc les laisser reviendrait à
// polluer l'historique à chaque action. Une commande peut imposer son propre
// délai via `autoDelete` ; les catégories absentes d'ici ne sont jamais
// effacées (`&help`, `&perms`, les panels... qu'on veut pouvoir relire).
const AUTO_DELETE_MS = {
  channel: 3_000,
  moderation: 5_000,
};

function scheduleCleanup(ctx, command) {
  const delay = command.autoDelete ?? AUTO_DELETE_MS[command.category];
  if (!delay || !ctx.sent.length) return;

  // Copie : `ctx` peut encore servir, et on veut figer la liste d'alors.
  const messages = [...ctx.sent];
  setTimeout(() => {
    for (const message of messages) message.delete().catch(() => {});
  }, delay);
}

async function replyError(ctx, message) {
  await ctx.reply(ctx.card({ title: "Erreur", description: message }));
}

// `add <rôle>`/`del <rôle>` en réponse à un membre — raccourci direct hérité
// de l'ancien système (voir utils/rolePanels.js), toujours utile en plus des
// commandes `&addrole`/`&delrole` (qui, elles, passent par un menu Discord).
async function tryRoleShortcut(client, message) {
  const match = message.content.trim().match(/^(add|del)\s+(.+)$/i);
  if (!match) return false;

  const action = match[1].toLowerCase();
  const roleName = match[2].trim().toLowerCase();

  const target =
    message.mentions.members?.first() ||
    (message.reference
      ? await message
          .fetchReference()
          .then((ref) => ref.member || message.guild.members.fetch(ref.author.id).catch(() => null))
          .catch(() => null)
      : null);
  if (!target) return false;

  const role = message.guild.roles.cache.find((r) => r.id !== message.guild.id && r.name.toLowerCase() === roleName);
  if (!role) return false;

  const commandName = action === "add" ? "addrole" : "delrole";
  const command = loadAllCommands().get(commandName);
  if (!command || isDisabled(command) || !checkAccess(command, message.member).allowed) return true; // silencieux, comme avant

  await (action === "add" ? addRoleDirect : delRoleDirect)(message, target.id, role.id);
  return true;
}

async function handleModerationTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  await waitForHydration(message.guild.id);

  const prefix = getPrefixes(message.guild.id).musicMod;
  if (await tryRoleShortcut(client, message)) return;

  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = (args.shift() || "").toLowerCase();
  if (!commandName) return;

  const registry = loadAllCommands();
  const command = registry.get(commandName);
  if (!command) return;

  const ctx = buildContext({ message, args, client });

  // "Pas le droit" / "désactivée ici" : on ne répond RIEN. Sans ça le bot
  // spamme le salon dès qu'un membre tape une commande qu'il ne peut pas
  // utiliser. Ce qui est accessible se découvre via `&help`, qui ne liste
  // que les commandes réellement utilisables par la personne.
  if (isDisabled(command)) return;
  if (!ctx.isSuperSys && channelBlacklistStore.isBlacklisted(ctx.guildId, command.name, message.channel.id)) return;

  // canRunCommand couvre aussi l'accès Voice Master pour `voc` (voir
  // utils/voiceAccess.js) ; checkAccess reste utilisé juste après pour le
  // cooldown, qui lui vient toujours du slot de permission.
  if (!canRunCommand(command, message.member)) return;
  const access = checkAccess(command, message.member);

  if (access.cooldownSeconds) {
    const key = `${ctx.guildId}:${message.author.id}:${command.name}`;
    const ms = access.cooldownSeconds * 1000;
    if (cooldowns.isOnCooldown(key, ms)) {
      const remaining = Math.ceil(cooldowns.remainingMs(key, ms) / 1000);
      await replyError(ctx, `Patiente encore ${remaining}s avant de réutiliser cette commande.`);
      return;
    }
  }

  const level = effectiveLevel(command);
  if (level === LEVEL.CONFIGURABLE || level === LEVEL.CONFIGURABLE_NO_COOLDOWN) {
    const z = antiraidDetector.recordSample(ctx.guildId, message.author.id);
    const tier = antiraidDetector.resolveTier(ctx.guildId, z);
    if (tier) {
      const { proceed } = await antiraidDetector.applyTier(message, command, tier, ctx, z);
      if (!proceed) return;
    }
  }

  try {
    await command.execute(ctx);
  } catch (error) {
    if (error instanceof UsageError || error instanceof PermissionError || error instanceof BotError) {
      await replyError(ctx, error.message);
    } else {
      console.error(`[modMessageRouter] commande "${command.name}" en échec :`, error);
      await replyError(ctx, "Une erreur inattendue est survenue.");
    }
  } finally {
    // Aussi en cas d'erreur : un message d'erreur de `&lock` n'a pas plus de
    // raison de rester dans le salon que sa confirmation.
    scheduleCleanup(ctx, command);
  }
}

module.exports = { handleModerationTextCommand };
