const { loadAllCommands } = require("./modCommandLoader");
const { checkAccess, isDisabled } = require("./accessControl");
const voiceMasterStore = require("./voiceMasterStore");

const VOC_COMMAND = "voc";

/**
 * Deux voies d'accès indépendantes aux actions vocales :
 *  1. la commande `voc` ajoutée à un slot dans &panel > Permissions
 *     (accès complet à toutes les actions) ;
 *  2. un rôle "Voice Master" (&panel > Voice Master), limité aux actions
 *     cochées dans cette rubrique.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {"move"|"mute"|"deaf"|"disconnect"} [action] omis = "a-t-il un accès
 *   vocal quelconque ?" (sert à savoir si on affiche le panneau)
 * @returns {boolean}
 */
function canDoVoiceAction(member, action) {
  const guildId = member.guild.id;

  const command = loadAllCommands().get(VOC_COMMAND);
  if (command && !isDisabled(command) && checkAccess(command, member).allowed) return true;

  if (!voiceMasterStore.isVoiceMaster(guildId, member)) return false;
  if (!action) return voiceMasterStore.getConfig(guildId).actions.length > 0;
  return voiceMasterStore.allowsAction(guildId, action);
}

module.exports = { canDoVoiceAction, VOC_COMMAND };
