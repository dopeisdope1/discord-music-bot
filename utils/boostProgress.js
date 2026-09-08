const { DateTime } = require("luxon");

// Progression des badges de BOOST de serveur.
//
// La date de départ est une VRAIE donnée Discord : `GuildMember.premiumSince`,
// l'instant où la personne a commencé à booster CE serveur. C'est la seule
// ancienneté que l'API expose à un bot — celle du Nitro (`premium_since` du
// profil utilisateur) n'est lisible qu'avec un token de compte, et n'a donc
// pas d'équivalent honnête ici.
//
// Conséquence à garder en tête en lisant l'écran : l'ancienneté affichée est
// celle du boost SUR CE SERVEUR. Quelqu'un qui boostait ailleurs avant repart
// de zéro ici, et c'est exact — le badge de Discord suit la même règle par
// serveur.

// Les paliers réels de Discord, en mois. Ils ne sont pas régulièrement
// espacés : c'est la grille officielle, pas une progression inventée.
const PALIERS = [0, 1, 2, 3, 6, 9, 12, 15, 18, 24];

/**
 * Forme dessinée pour chaque palier. Volontairement GÉOMÉTRIQUE et non les
 * médailles de Discord : ce sont ses assets de marque, on ne les recopie pas.
 * La progression reste lisible — la forme se complexifie avec l'ancienneté.
 */
const FORMES = {
  0: "triangle",
  1: "triangle",
  2: "losange",
  3: "losange-long",
  6: "hexagone",
  9: "carre",
  12: "etoile",
  15: "cristal",
  18: "hexagone-plein",
  24: "diamant",
};

/** Le palier atteint après `mois` d'ancienneté. */
function palierPour(mois) {
  let atteint = PALIERS[0];
  for (const palier of PALIERS) {
    if (mois >= palier) atteint = palier;
  }
  return atteint;
}

/** Le palier suivant, ou `null` quand le dernier est atteint. */
function palierSuivant(mois) {
  return PALIERS.find((p) => p > mois) ?? null;
}

/**
 * Progression complète d'un membre qui booste.
 *
 * @param {Date|number|null} debut `member.premiumSince` — `null` si la
 *   personne ne booste pas (ou plus) le serveur.
 * @param {Date|number} [maintenant] injectable pour les tests ; l'heure
 *   courante sinon.
 * @returns {null|{
 *   debut: Date, moisEcoules: number, joursEcoules: number,
 *   palierActuel: number, palierSuivant: number|null,
 *   pourcentage: number, dateSuivante: Date|null,
 *   paliers: {mois: number, date: Date, atteint: boolean, forme: string}[]
 * }} `null` quand il n'y a rien à afficher — l'appelant le dit alors en
 *   toutes lettres plutôt que de dessiner une progression inventée.
 */
function progression(debut, maintenant = Date.now()) {
  if (debut === null || debut === undefined) return null;
  const depart = DateTime.fromJSDate(debut instanceof Date ? debut : new Date(debut));
  if (!depart.isValid) return null;
  const now = DateTime.fromJSDate(maintenant instanceof Date ? maintenant : new Date(maintenant));

  // Un boost dont la date est dans le futur ne devrait pas exister ; s'il
  // arrive (horloge décalée), on ne renvoie pas une ancienneté négative.
  const ecoule = now.diff(depart, ["months", "days"]).toObject();
  const moisEcoules = Math.max(0, Math.floor(now.diff(depart, "months").months));
  const joursEcoules = Math.max(0, Math.floor(now.diff(depart, "days").days));

  const actuel = palierPour(moisEcoules);
  const suivant = palierSuivant(moisEcoules);

  // Le pourcentage mesure le chemin parcouru ENTRE deux paliers, pas depuis le
  // début : sinon la barre resterait quasi vide pendant les deux premières
  // années, puisque le dernier palier est à 24 mois.
  let pourcentage = 100;
  let dateSuivante = null;
  if (suivant !== null) {
    const debutPalier = depart.plus({ months: actuel });
    const finPalier = depart.plus({ months: suivant });
    dateSuivante = finPalier.toJSDate();
    const total = finPalier.diff(debutPalier).as("milliseconds");
    const fait = now.diff(debutPalier).as("milliseconds");
    pourcentage = total > 0 ? Math.min(100, Math.max(0, Math.round((fait / total) * 100))) : 0;
  }

  return {
    debut: depart.toJSDate(),
    moisEcoules,
    joursEcoules,
    palierActuel: actuel,
    palierSuivant: suivant,
    pourcentage,
    dateSuivante,
    paliers: PALIERS.map((mois) => {
      const date = depart.plus({ months: mois });
      return { mois, date: date.toJSDate(), atteint: date <= now, forme: FORMES[mois] };
    }),
    // `ecoule` sert au libellé « 2 mois et 5 jours » sans le recalculer.
    reste: { mois: Math.max(0, Math.floor(ecoule.months || 0)), jours: Math.max(0, Math.floor(ecoule.days || 0)) },
  };
}

/**
 * « dans 13 jours », « il y a 2 mois » — même vocabulaire que Discord.
 *
 * Luxon tronque vers l'unité inférieure : à 22 mois d'échéance il annonçait
 * « dans 1 an », ce qui sous-estime de dix mois et rendait indistinguables les
 * paliers 15, 18 et 24 mois. Au-delà d'un an on compte donc en mois, l'unité
 * dans laquelle les paliers sont eux-mêmes définis.
 */
function relatif(date, maintenant = Date.now()) {
  const cible = DateTime.fromJSDate(date instanceof Date ? date : new Date(date));
  const base = DateTime.fromJSDate(maintenant instanceof Date ? maintenant : new Date(maintenant));
  const mois = Math.abs(cible.diff(base, "months").months);
  const options = { base, ...(mois >= 12 ? { unit: "months" } : {}) };
  return cible.setLocale("fr").toRelative(options);
}

/** « 21/06/2026 » — format court, celui des captures. */
function dateCourte(date) {
  return DateTime.fromJSDate(date instanceof Date ? date : new Date(date)).setLocale("fr").toFormat("dd/LL/yyyy");
}

/** « dimanche 21 juin 2026 à 13h24 » — l'en-tête de la carte. */
function dateLongue(date) {
  return DateTime.fromJSDate(date instanceof Date ? date : new Date(date)).setLocale("fr").toFormat("cccc dd LLLL yyyy 'à' HH'h'mm");
}

module.exports = { PALIERS, FORMES, progression, palierPour, palierSuivant, relatif, dateCourte, dateLongue };
