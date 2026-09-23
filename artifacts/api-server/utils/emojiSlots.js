const { CATEGORIES } = require("./commandCatalog");
const { EMOJI } = require("./emojis");
const categoryEmojiStore = require("./categoryEmojiStore");

// "&emoji" personnalise l'emoji de chaque GROUPE affiché dans l'aide (voir
// utils/helpNavigator.js) — un "slot" par groupe, jamais par commande
// individuelle (~210 commandes, bien trop pour un menu Discord de 25
// options ; les groupes, eux, tiennent largement dedans).

// Slots "icon:XXX" — un par clé du registre de design utils/emojis.js
// (succès/erreur, ban, couronne, ticket...), personnalisables au même titre
// que les groupes d'aide. Regroupés par thème pour un select menu lisible ;
// `categorie` sert UNIQUEMENT à l'affichage groupé du panel (utils/
// emojiPanel.js), jamais à la résolution (`icon:${clé}` reste la clé réelle).
const GROUPES_ICONES = {
  "Icônes — Statuts": ["SUCCESS", "ERROR", "INFO", "CHECK", "CROSS"],
  "Icônes — Modération": ["BAN", "KICK", "MUTE", "UNMUTE", "DELETE", "PENCIL"],
  "Icônes — Rangs": ["OWNER", "CROWN", "STAFF", "STAFF_AWAY"],
  "Icônes — Serveur": ["TICKET", "LOCK", "MAIL", "RULES", "MEMBERS", "ONLINE", "VOICE", "SCREENSHARE"],
  "Icônes — Divers": ["DISCORD", "ARROW", "ARROW_GREEN", "BOING"],
};

const SLOTS_ICONES = Object.entries(GROUPES_ICONES).flatMap(([groupe, cles]) =>
  cles.map((cle) => ({ key: `icon:${cle}`, label: `${groupe} — ${cle}`, defaultEmoji: EMOJI[cle], categorie: groupe }))
);

const SLOTS = [
  ...CATEGORIES.map((c) => ({ key: `cat:${c.key}`, label: `&help — ${c.label}`, defaultEmoji: c.emoji, categorie: "&help" })),
  ...SLOTS_ICONES,
];

const SLOT_PAR_CLE = new Map(SLOTS.map((s) => [s.key, s]));

/** L'emoji réellement affiché pour ce slot sur ce serveur — personnalisé, ou par défaut. */
function emojiDe(guildId, slotKey) {
  const slot = SLOT_PAR_CLE.get(slotKey);
  if (!slot) return null;
  return categoryEmojiStore.get(guildId, slotKey) || slot.defaultEmoji;
}

/** L'icône réellement affichée pour cette clé de utils/emojis.js sur ce serveur — personnalisée, ou celle du registre. */
function iconDe(guildId, emojiKey) {
  return emojiDe(guildId, `icon:${emojiKey}`) || EMOJI[emojiKey] || null;
}

module.exports = { SLOTS, emojiDe, iconDe };
