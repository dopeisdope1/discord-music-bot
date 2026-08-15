const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("./permLevels");
const botAdminsStore = require("./botAdminsStore");
const commandStateStore = require("./commandStateStore");
const permissionEngine = require("./permissionEngine");

function effectiveLevel(commandModule) {
  const override = commandStateStore.getOverride(commandModule.name);
  return override?.level || commandModule.level;
}

function isDisabled(commandModule) {
  const override = commandStateStore.getOverride(commandModule.name);
  return Boolean(override?.disabled);
}

// Retourne { allowed, cooldownSeconds? }. `cooldownSeconds` n'a de sens que
// pour `configurable` (0 pour configurableNoCooldown, absent sinon).
function checkAccess(commandModule, member) {
  const level = effectiveLevel(commandModule);

  if (level === LEVEL.PUBLIC) return { allowed: true };
  if (botAdminsStore.isSuperSys(member.id)) return { allowed: true };
  if (level === LEVEL.SUPER_SYS) return { allowed: false };
  if (level === LEVEL.SYS) return { allowed: botAdminsStore.isSysOrAbove(member.id) };

  if (level === LEVEL.OWNER) {
    const isGuildTop =
      member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator);
    return { allowed: isGuildTop };
  }

  if (level === LEVEL.CONFIGURABLE || level === LEVEL.CONFIGURABLE_NO_COOLDOWN) {
    const { commands, cooldownByCommand } = permissionEngine.resolveForMember(member.guild.id, member);
    if (!commands.has(commandModule.name)) return { allowed: false };
    const cooldownSeconds =
      level === LEVEL.CONFIGURABLE_NO_COOLDOWN ? 0 : cooldownByCommand.get(commandModule.name) ?? 0;
    return { allowed: true, cooldownSeconds };
  }

  return { allowed: false };
}

module.exports = { checkAccess, effectiveLevel, isDisabled };
