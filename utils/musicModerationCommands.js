const { getPrefixes } = require("./prefixStore");
const { waitForHydration } = require("./configChannel");
const { canUseCommand } = require("./permissions");
const { buildStatusEmbed } = require("./statusEmbed");
const { addRoleDirect, delRoleDirect } = require("./rolePanels");
const { handlers } = require("./moderationCommands");
const { sendDashHelpPanel } = require("./helpPanels");

// Jeu de commandes de modération du bot Musique (voir
// utils/moderationCommands.js, dont on réutilise directement les handlers).
// Sous-ensemble volontaire : pas de pic/avatar/snipe/gif ici.
const ADMIN_COMMANDS = new Set([
  "renew",
  "hide",
  "unhide",
  "lock",
  "unlock",
  "massrole",
  "panel",
  "create",
  "greet",
  "addbienvenue",
  "delbienvenue",
  "listbienvenue",
  "perms",
  "helpall",
]);
const BAN_COMMANDS = new Set(["ban", "unban", "unbanall"]);
const COMMANDS = new Set([...ADMIN_COMMANDS, ...BAN_COMMANDS, "banall", "clear"]);
// Pour `&help` (voir utils/helpPanels.js) — mêmes commandes que COMMANDS
// ci-dessus (add/del inclus, sans préfixe).
const HELP_MODERATION_COMMANDS = [
  "renew",
  "hide",
  "unhide",
  "lock",
  "unlock",
  "massrole",
  "panel",
  "create",
  "clear",
  "add",
  "del",
  "greet",
  "addbienvenue",
  "delbienvenue",
  "listbienvenue",
  "perms",
  "helpall",
];

function requireCommandAccess(message, cmd) {
  if (!canUseCommand(message, cmd)) {
    message.reply({
      embeds: [buildStatusEmbed("error", "Tu n'as pas la permission d'utiliser cette commande.")],
    });
    return false;
  }
  return true;
}

/**
 * À appeler dans l'écouteur "messageCreate" du bot Musique, en plus de
 * handleMusicTextCommand — dispatch indépendant sur son propre préfixe
 * (`musicMod`, `&` par défaut, configurable via `&panel`).
 */
async function handleMusicModerationTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  await waitForHydration(message.guild.id);

  const content = message.content.trim();
  const { musicMod: PREFIX } = getPrefixes(message.guild.id);

  const SELF_CLEAR_TRIGGERS = new Set(["uo clear", "clear me", "anas clear", "yanis clear"]);
  const lowerContent = content.toLowerCase();
  if (SELF_CLEAR_TRIGGERS.has(lowerContent)) {
    return handlers.clear(client, message, ["me"], PREFIX);
  }

  const addDelMatch = content.match(/^(add|del)\s+(.+)$/i);
  if (addDelMatch) {
    const action = addDelMatch[1].toLowerCase();
    const roleName = addDelMatch[2].trim().toLowerCase();

    const target =
      message.mentions.members?.first() ||
      (message.reference
        ? await message
            .fetchReference()
            .then((ref) => ref.member || message.guild.members.fetch(ref.author.id).catch(() => null))
            .catch(() => null)
        : null);
    const role = target ? message.guild.roles.cache.find((r) => r.id !== message.guild.id && r.name.toLowerCase() === roleName) : null;

    if (target && role) {
      if (canUseCommand(message, action)) {
        return (action === "add" ? addRoleDirect : delRoleDirect)(message, target.id, role.id);
      }
      return;
    }
  }

  if (!content.startsWith(PREFIX)) return;

  const [cmdRaw, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || "").toLowerCase();
  if (cmd === "help") {
    return sendDashHelpPanel(message, PREFIX, { moderationCommands: HELP_MODERATION_COMMANDS });
  }
  if (cmd === "clear") {
    return handlers.clear(client, message, args, PREFIX);
  }
  if (BAN_COMMANDS.has(cmd)) {
    if (!requireCommandAccess(message, cmd)) return;
    return handlers[cmd](client, message, args, PREFIX);
  }
  if (!COMMANDS.has(cmd)) return;
  if (ADMIN_COMMANDS.has(cmd) && !requireCommandAccess(message, cmd)) return;
  return handlers[cmd](client, message, args, PREFIX);
}

module.exports = { handleMusicModerationTextCommand };
