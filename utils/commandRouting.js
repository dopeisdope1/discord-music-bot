const { CATEGORIES } = require("./commandCatalog");

// Routage des mots de commande vers un PRÉFIXE, pour l'architecture 4
// préfixes : & = gestion, - = modération, !! = sécurité, = = vocal.
//
// Source de vérité : la catégorie de chaque commande dans
// utils/commandCatalog.js. Un mot qui apparaît dans plusieurs catégories
// prend la PREMIÈRE (ordre du catalogue = précédence : moderation, securite,
// puis les catégories de gestion). Bucket final :
//   moderation  -> "-"
//   securite    -> "!!"
//   tout le reste (serveurroles/communaute/informations/outils/bot, ou mot
//   absent du catalogue) -> "&" (gestion)
//
// OVERRIDES : quelques mots dont la catégorie catalogue est trompeuse pour
// le routage (multi-usage), ou des alias absents du catalogue mais qui
// doivent suivre leur commande principale.

const BUCKET_MODERATION = "moderation";
const BUCKET_SECURITE = "securite";
const BUCKET_GESTION = "gestion";

const OVERRIDES = {
  set: BUCKET_GESTION, // config/bot, pas sécurité
  muterole: BUCKET_MODERATION, // rôle de mute (utilisé par -mute)
  purge: BUCKET_MODERATION, // alias de clear
  panic: BUCKET_MODERATION, // alias de lockdown
  cmute: BUCKET_MODERATION, // mute de salon
  tempcmute: BUCKET_MODERATION,
  uncmute: BUCKET_MODERATION,
};

function motDeBase(name) {
  return name.trim().split(/\s+/)[0].toLowerCase().replace(/[<[|].*$/, "");
}

// word -> première catégorie rencontrée (ordre du catalogue = précédence).
const WORD_CATEGORY = {};
for (const cat of CATEGORIES) {
  for (const c of cat.commands) {
    const w = motDeBase(c.name);
    if (!(w in WORD_CATEGORY)) WORD_CATEGORY[w] = cat.key;
  }
}

/**
 * Bucket de routage d'un mot de commande.
 * @returns {"moderation"|"securite"|"gestion"}
 */
function bucketDe(word) {
  const w = (word || "").toLowerCase();
  if (OVERRIDES[w]) return OVERRIDES[w];
  const cat = WORD_CATEGORY[w];
  if (cat === "moderation") return BUCKET_MODERATION;
  if (cat === "securite") return BUCKET_SECURITE;
  return BUCKET_GESTION; // gestion, ou mot inconnu (reste sur "&")
}

module.exports = {
  bucketDe,
  BUCKET_MODERATION,
  BUCKET_SECURITE,
  BUCKET_GESTION,
  WORD_CATEGORY,
  OVERRIDES,
};
