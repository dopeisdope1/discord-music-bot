const { createCanvas } = require("@napi-rs/canvas");
const { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require("discord.js");
// Déclenche l'enregistrement des polices (Chakra Petch ET Nunito, voir
// utils/dashboardImage.js) et fournit `ecrire`/`largeur` — jamais
// ctx.fillText directement avec Chakra Petch, sans quoi l'esperluette « & »
// ressort en « 8 » barré (voir le commentaire détaillé dans dashboardImage.js;
// `ecrire`/`largeur` ne font rien de spécial pour les autres polices comme
// Nunito, sans esperluette à corriger).
const { ecrire, largeur } = require("./dashboardImage");

// Les cartes visuelles des confessions (utils/confessions.js) : demande
// explicite, capture à l'appui, de reproduire le langage d'une carte
// d'application moderne — PAS un embed Discord classique avec une barre
// colorée sur le côté. Deux gabarits, selon la référence fournie :
//  - dessinerCarte : UN bloc dégradé, gros texte blanc — sert à la carte
//    d'accroche ("Confesse-toi"). Police Chakra Petch (ChakraBold), inchangée.
//  - dessinerCarteConfession : DEUX zones empilées (bande dégradée avec un
//    texte fixe en haut, fond blanc avec le message en noir en bas) —
//    sert à chaque confession publiée, exactement comme sur la seconde
//    référence fournie ("envoie-moi des messages anonymes !" en haut,
//    "Baisons eren les amis" en bas). Police Nunito (NunitoBold) — écriture
//    normale/ronde, demande explicite ("pas en carré bizarre", capture de
//    référence à l'appui) : Chakra Petch a un rendu trop technique/anguleux
//    pour un vrai message de confession.

const LARGEUR = 900;
const RAYON = 48;

// La police embarquée (Chakra Petch) n'a AUCUN glyphe d'emoji — voir
// utils/dashboardImage.js et scripts/test-sans-emoji.js. Un message de
// confession est du texte libre : on retire les emoji avant de les dessiner
// plutôt que de laisser des rectangles vides apparaître sur la carte. Le
// texte alternatif de l'image, lui, garde le texte d'origine intact.
function retirerEmoji(texte) {
  return String(texte)
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cheminArrondi(ctx, x, y, l, h, r) {
  const rayon = Math.min(r, l / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rayon, y);
  ctx.arcTo(x + l, y, x + l, y + h, rayon);
  ctx.arcTo(x + l, y + h, x, y + h, rayon);
  ctx.arcTo(x, y + h, x, y, rayon);
  ctx.arcTo(x, y, x + l, y, rayon);
  ctx.closePath();
}

function envelopper(ctx, texte, largeurMax) {
  const mots = String(texte).split(/\s+/).filter(Boolean);
  const lignes = [];
  let courante = "";
  for (const mot of mots) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (!courante || largeur(ctx, essai) <= largeurMax) courante = essai;
    else {
      lignes.push(courante);
      courante = mot;
    }
  }
  if (courante) lignes.push(courante);
  return lignes;
}

/** La plus grande taille (entre tailleMax et tailleMin) dont TOUTES les lignes tiennent dans hauteurMax ; au-delà, tronque la dernière ligne visible. */
function ajusterTexte(ctx, texte, { largeurMax, hauteurMax, police, tailleMax, tailleMin }) {
  for (let taille = tailleMax; taille >= tailleMin; taille -= 4) {
    ctx.font = `${taille}px ${police}`;
    const lignes = envelopper(ctx, texte, largeurMax);
    const interligne = Math.round(taille * 1.3);
    if (lignes.length * interligne <= hauteurMax) return { lignes, interligne };
  }
  ctx.font = `${tailleMin}px ${police}`;
  const interligne = Math.round(tailleMin * 1.3);
  const maxLignes = Math.max(1, Math.floor(hauteurMax / interligne));
  let lignes = envelopper(ctx, texte, largeurMax);
  if (lignes.length > maxLignes) {
    lignes = lignes.slice(0, maxLignes);
    let derniere = lignes[maxLignes - 1];
    while (derniere.length > 1 && largeur(ctx, `${derniere}…`) > largeurMax) derniere = derniere.slice(0, -1);
    lignes[maxLignes - 1] = `${derniere.trimEnd()}…`;
  }
  return { lignes, interligne };
}

/** Dessine du texte centré (horizontalement ET verticalement) dans une zone rectangulaire — partagé par les deux gabarits de carte. */
function dessinerTexteZone(ctx, texte, { x, y, largeurZone, hauteurZone, couleur, police, tailleMax, tailleMin, margeH = 90, margeV = 50 }) {
  const texteAffiche = retirerEmoji(texte) || "…";
  const { lignes, interligne } = ajusterTexte(ctx, texteAffiche, {
    largeurMax: largeurZone - margeH * 2,
    hauteurMax: hauteurZone - margeV * 2,
    police,
    tailleMax,
    tailleMin,
  });

  ctx.fillStyle = couleur;
  ctx.textAlign = "left"; // le centrage se calcule à la main : voir dashboardImage.js::ecrire, qui exige un dessin gauche->droite pour son détour "&"
  ctx.textBaseline = "middle";
  const centreX = x + largeurZone / 2;
  const depart = y + hauteurZone / 2 - ((lignes.length - 1) * interligne) / 2;
  lignes.forEach((ligne, i) => {
    const lx = centreX - largeur(ctx, ligne) / 2;
    ecrire(ctx, ligne, lx, depart + i * interligne);
  });
}

/**
 * Carte à UN bloc : dégradé rose -> orange sur toute la surface, gros texte
 * blanc centré — sert à la carte d'accroche ("Confesse-toi").
 * @returns {Buffer} PNG
 */
function dessinerCarte(texte, { hauteur = 380 } = {}) {
  const canvas = createCanvas(LARGEUR, hauteur);
  const ctx = canvas.getContext("2d");

  cheminArrondi(ctx, 0, 0, LARGEUR, hauteur, RAYON);
  ctx.save();
  ctx.clip();

  const degrade = ctx.createLinearGradient(0, 0, LARGEUR, hauteur);
  degrade.addColorStop(0, "#ec4899");
  degrade.addColorStop(1, "#f97316");
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, LARGEUR, hauteur);

  const halo = ctx.createRadialGradient(LARGEUR / 2, hauteur / 2, hauteur / 6, LARGEUR / 2, hauteur / 2, LARGEUR / 1.1);
  halo.addColorStop(0, "rgba(255,255,255,0.12)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, LARGEUR, hauteur);
  ctx.restore();

  dessinerTexteZone(ctx, texte, { x: 0, y: 0, largeurZone: LARGEUR, hauteurZone: hauteur, couleur: "#ffffff", police: "ChakraBold", tailleMax: 60, tailleMin: 26 });

  return canvas.toBuffer("image/png");
}

// "Envoie-moi ton message anonyme !" occupe toujours la bande du haut — texte
// FIXE (ce n'est pas la confession elle-même), dans le même esprit que la
// référence fournie.
const ENTETE_CONFESSION = "Envoie-moi ton message anonyme !";
const RATIO_ENTETE = 0.4;

/**
 * Carte à DEUX zones empilées, exactement comme la seconde référence
 * fournie : une bande dégradée en haut avec un texte fixe, et une zone
 * blanche en bas avec le message de la confession en noir.
 * @returns {Buffer} PNG
 */
function dessinerCarteConfession(texte, { hauteur = 420 } = {}) {
  const canvas = createCanvas(LARGEUR, hauteur);
  const ctx = canvas.getContext("2d");
  const hauteurEntete = Math.round(hauteur * RATIO_ENTETE);
  const hauteurCorps = hauteur - hauteurEntete;

  cheminArrondi(ctx, 0, 0, LARGEUR, hauteur, RAYON);
  ctx.save();
  ctx.clip();

  const degrade = ctx.createLinearGradient(0, 0, LARGEUR, hauteurEntete);
  degrade.addColorStop(0, "#ec4899");
  degrade.addColorStop(1, "#f97316");
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, LARGEUR, hauteurEntete);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, hauteurEntete, LARGEUR, hauteurCorps);
  ctx.restore();

  dessinerTexteZone(ctx, ENTETE_CONFESSION, {
    x: 0,
    y: 0,
    largeurZone: LARGEUR,
    hauteurZone: hauteurEntete,
    couleur: "#ffffff",
    police: "NunitoBold",
    tailleMax: 44,
    tailleMin: 24,
    margeH: 70,
    margeV: 20,
  });
  dessinerTexteZone(ctx, texte, {
    x: 0,
    y: hauteurEntete,
    largeurZone: LARGEUR,
    hauteurZone: hauteurCorps,
    couleur: "#161616",
    police: "NunitoBold",
    tailleMax: 50,
    tailleMin: 24,
    margeH: 70,
    margeV: 30,
  });

  return canvas.toBuffer("image/png");
}

let compteurImages = 0;

/**
 * @param {(texte: string, opts: object) => Buffer} dessiner laquelle des deux fonctions ci-dessus utiliser
 * @returns {{ fichier: AttachmentBuilder, galerie: MediaGalleryBuilder }} prêts
 *   à être ajoutés à un ContainerBuilder (addMediaGalleryComponents) et au
 *   payload d'envoi (`files: [fichier]`).
 */
function carteEnComposants(dessiner, texte, { hauteur, texteAlternatif } = {}) {
  const buffer = dessiner(texte, { hauteur });
  const nom = `confess-${++compteurImages}.png`;
  const fichier = new AttachmentBuilder(buffer, { name: nom, description: (texteAlternatif || texte).slice(0, 1024) });
  const galerie = new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${nom}`));
  return { fichier, galerie };
}

const buildCarteVisuelle = (texte, opts) => carteEnComposants(dessinerCarte, texte, opts);
const buildCarteVisuelleConfession = (texte, opts) => carteEnComposants(dessinerCarteConfession, texte, opts);

module.exports = {
  dessinerCarte,
  dessinerCarteConfession,
  buildCarteVisuelle,
  buildCarteVisuelleConfession,
  retirerEmoji,
  LARGEUR,
};
