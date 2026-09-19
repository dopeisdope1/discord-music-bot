const { CATEGORIES } = require("./commandCatalog");
const { CATEGORIES: CATEGORIES_VOCAL } = require("./voiceHelpCommand");
const categoryEmojiStore = require("./categoryEmojiStore");

// "&emoji" personnalise l'emoji de chaque GROUPE affiché dans l'aide (voir
// utils/helpNavigator.js) — un "slot" par groupe, jamais par commande
// individuelle (~210 commandes, bien trop pour un menu Discord de 25
// options ; les groupes, eux, tiennent largement dedans).
//
// Groupes "!!" : utils/protectionHelpCommand.js n'a pas d'emoji par groupe
// (c'est une carte figée simple) — attribués ici, une fois, source unique
// pour l'affichage ET la personnalisation.
const EMOJI_GROUPE_SECURITE = { "Sécurité serveur": "🛡️", "Protection personnelle": "🔒", Autres: "🧰" };

const SLOTS = [
  ...CATEGORIES.map((c) => ({ key: `cat:${c.key}`, label: `&help — ${c.label}`, defaultEmoji: c.emoji })),
  ...Object.entries(EMOJI_GROUPE_SECURITE).map(([groupe, emoji]) => ({ key: `sec:${groupe}`, label: `!!help — ${groupe}`, defaultEmoji: emoji })),
  ...CATEGORIES_VOCAL.map((c) => ({ key: `voc:${c.nom}`, label: `=help — ${c.nom}`, defaultEmoji: c.emoji })),
];

const SLOT_PAR_CLE = new Map(SLOTS.map((s) => [s.key, s]));

/** L'emoji réellement affiché pour ce slot sur ce serveur — personnalisé, ou par défaut. */
function emojiDe(guildId, slotKey) {
  const slot = SLOT_PAR_CLE.get(slotKey);
  if (!slot) return null;
  return categoryEmojiStore.get(guildId, slotKey) || slot.defaultEmoji;
}

module.exports = { SLOTS, EMOJI_GROUPE_SECURITE, emojiDe };
