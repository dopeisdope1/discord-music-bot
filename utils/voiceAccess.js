const { loadAllCommands } = require("./modCommandLoader");
const { checkAccess, isDisabled } = require("./accessControl");
const permissionEngine = require("./permissionEngine");
const botAdminsStore = require("./botAdminsStore");

const VOC_COMMAND = "voc";

// Actions vocales assignables, dans l'ordre d'affichage du panel.
const VOICE_ACTIONS = [
  { key: "move", label: "Déplacer les membres" },
  { key: "mute", label: "Rendre muet / rendre la parole" },
  { key: "deaf", label: "Mettre en sourdine / réactiver" },
  { key: "disconnect", label: "Déconnecter du vocal" },
];

const actionLabel = (key) => VOICE_ACTIONS.find((a) => a.key === key)?.label || key;

/**
 * Actions vocales dont dispose un membre, accordées PAR SLOT dans
 * &panel > Permissions (chaque slot a sa propre liste, y compris les slots
 * exclusifs). Un slot qui contient la commande `voc` donne les 4 actions —
 * raccourci pratique équivalent à tout cocher.
 * @returns {Set<string>}
 */
function voiceActionsOf(member) {
  if (botAdminsStore.isSysOrAbove(member.id)) return new Set(VOICE_ACTIONS.map((a) => a.key));

  const { slots } = permissionEngine.resolveSlotsForMember(member.guild.id, member);
  const actions = new Set();

  for (const slot of slots) {
    if (slot.commands.includes(VOC_COMMAND)) {
      for (const a of VOICE_ACTIONS) actions.add(a.key);
    }
    for (const key of slot.voiceActions || []) actions.add(key);
  }

  return actions;
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {"move"|"mute"|"deaf"|"disconnect"} [action] omis = "a-t-il un accès
 *   vocal quelconque ?" (sert à savoir si on affiche le panneau)
 */
function canDoVoiceAction(member, action) {
  const actions = voiceActionsOf(member);
  return action ? actions.has(action) : actions.size > 0;
}

/**
 * Accès à une commande en tenant compte des deux voies : le slot qui contient
 * la commande, et — pour `voc` — le fait d'avoir au moins une action vocale
 * cochée quelque part. Sans ça, un slot qui n'accorde que "Déplacer" ne
 * pourrait pas ouvrir `&voc` et la commande resterait invisible dans `&help`.
 */
function canRunCommand(command, member) {
  if (isDisabled(command)) return false;
  if (checkAccess(command, member).allowed) return true;
  return command.name === VOC_COMMAND && canDoVoiceAction(member);
}

module.exports = { canDoVoiceAction, canRunCommand, voiceActionsOf, VOICE_ACTIONS, actionLabel, VOC_COMMAND };
