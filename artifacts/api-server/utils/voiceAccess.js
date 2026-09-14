const permStore = require("./permissions/store");
const { can } = require("./permissions/engine");

// Accès vocaux accordés via "=owner"/"=add" (préfixe vocal "="). Chaque
// entrée = le DROIT d'utiliser UNE commande vocale précise, stocké comme une
// permission individuelle "voice.<cmd>" via permStore (par guild + user),
// exactement comme les autres octrois individuels du bot. "=owner" bascule
// toutes les clés en une fois ; "=add" ouvre la carte "Owner" en liste plate
// à cocher (✓/✗), au lieu du catalogue générique de permissions
// (Modération/Salons/Membres…). Ces accès ne modifient jamais BOT_OWNER_IDS
// ni le rang sys.
//
// Seules les VRAIES commandes vocales de ce bot figurent ici : les libellés
// de l'autre bot (dog/pv/pvlist/pvclear/follow) n'existent pas ici et ne
// sont donc pas inventés.
// `perm` = la permission GLOBALE (staff) qui débloque déjà cette commande.
// La plupart : server.voice.manage. bringall (déplacement de masse) garde son
// droit plus strict server.voice.moveall (voir test-dangerous-permissions-split).
const VOICE_ACCESS = [
  { key: "voice.mute", label: "mute", description: "Mute vocal (=mute)", perm: "server.voice.manage" },
  { key: "voice.unmute", label: "unmute", description: "Démute vocal (=unmute)", perm: "server.voice.manage" },
  { key: "voice.deaf", label: "deaf", description: "Sourdine (=deaf)", perm: "server.voice.manage" },
  { key: "voice.undeaf", label: "undeaf", description: "Retire la sourdine (=undeaf)", perm: "server.voice.manage" },
  { key: "voice.disconnect", label: "disconnect", description: "Expulse du vocal (=disconnect)", perm: "server.voice.manage" },
  { key: "voice.mv", label: "mv", description: "Déplace un membre (=mv / =move)", perm: "server.voice.manage" },
  { key: "voice.join", label: "join", description: "Te déplace vers un membre (=join)", perm: "server.voice.manage" },
  { key: "voice.find", label: "find", description: "Trouve un membre en vocal (=find)", perm: "server.voice.manage" },
  { key: "voice.bringall", label: "bringall", description: "Rassemble tout le monde (=bringall)", perm: "server.voice.moveall" },
  { key: "voice.wakeup", label: "wakeup", description: "Réveille un membre (=wakeup)", perm: "server.voice.manage" },
];

const VOICE_ACCESS_KEYS = VOICE_ACCESS.map((a) => a.key);
const LABEL_PAR_CLE = Object.fromEntries(VOICE_ACCESS.map((a) => [a.key, a.label]));
const PERM_PAR_CLE = Object.fromEntries(VOICE_ACCESS.map((a) => [a.key, a.perm]));

/**
 * Un membre peut utiliser une commande vocale s'il a le droit GLOBAL (staff)
 * PROPRE à cette commande (server.voice.manage, ou server.voice.moveall pour
 * bringall), OU l'accès INDIVIDUEL `voice.<cmd>` accordé via "=owner" (ou la
 * carte granulaire "=add").
 * `accessKey` est une clé de VOICE_ACCESS (ex. "voice.wakeup").
 */
function peutVocal(member, accessKey) {
  const perm = PERM_PAR_CLE[accessKey] || "server.voice.manage";
  if (can(member, perm)) return true;
  return permStore.getUserGrants(member.guild.id, member.id).includes(accessKey);
}

module.exports = { VOICE_ACCESS, VOICE_ACCESS_KEYS, LABEL_PAR_CLE, PERM_PAR_CLE, peutVocal };
