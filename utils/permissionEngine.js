const permissionsStore = require("./permissionsStore");

// Rang = position la plus haute parmi les slots NON exclusifs auxquels le
// membre appartient directement (par rôle ou ajout direct). Un membre hérite
// des commandes de tout slot non exclusif à sa position ou en dessous (la
// cascade que `&helpall` appelle "cumulées jusqu'à son rang"). Les slots
// "exclusive" ne participent jamais à cette cascade — leurs commandes ne
// vont qu'aux rôles/membres directement attachés à CE slot précis.
function resolveSlotsForMember(guildId, member) {
  const roleIds = [...member.roles.cache.keys()];
  const allSlots = permissionsStore.listByGuild(guildId);
  const directSlots = permissionsStore.listForMember(guildId, member.id, roleIds);

  const directNonExclusive = directSlots.filter((s) => !s.exclusive);
  const rank = directNonExclusive.length ? Math.max(...directNonExclusive.map((s) => s.position)) : 0;

  const cascaded = rank > 0 ? allSlots.filter((s) => !s.exclusive && s.position <= rank) : [];
  const exclusiveDirect = directSlots.filter((s) => s.exclusive);

  return { rank, slots: [...cascaded, ...exclusiveDirect] };
}

// Aplati resolveSlotsForMember en l'ensemble des commandes accessibles, plus
// un cooldown par commande (le slot le plus proche du rang du membre gagne,
// puisque `slots` liste les slots en cascade par position croissante).
function resolveForMember(guildId, member) {
  const { rank, slots } = resolveSlotsForMember(guildId, member);
  const commands = new Set();
  const cooldownByCommand = new Map();

  for (const slot of slots) {
    for (const commandName of slot.commands) {
      commands.add(commandName);
      if (slot.cooldownSeconds != null) cooldownByCommand.set(commandName, slot.cooldownSeconds);
    }
  }

  return { rank, commands, cooldownByCommand };
}

module.exports = { resolveForMember, resolveSlotsForMember };
