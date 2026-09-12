const { createCanvas } = require("@napi-rs/canvas");
const { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require("discord.js");
// Déclenche l'enregistrement des polices Chakra Petch (même monde visuel que
// &help/&panel, voir utils/dashboardImage.js) et fournit `ecrire`/`largeur` —
// jamais ctx.fillText directement, sans quoi l'esperluette « & » ressort en
// « 8 » barré (voir le commentaire détaillé dans dashboardImage.js).
const { ecrire, largeur } = require("./dashboardImage");

// La carte visuelle des confessions (utils/confessions.js) : demande
// explicite, capture à l'appui, de reproduire le langage d'une carte
// d'application moderne (grands coins arrondis, dégradé, gros texte blanc
// centré) — PAS un embed Discord classique avec une barre colorée sur le
// côté. Une seule fonction de dessin, réutilisée pour la carte d'accroche
// ("Confesse-toi") ET pour chaque confession publiée : même gabarit, seul le
// texte change, exactement comme sur la référence fournie (la carte
// "envoie-moi des messages anonymes !" et les cartes de confession
// partagent un seul et même modèle visuel).

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

/**
 * Dessine LA carte : rectangle aux grands coins arrondis, dégradé
 * rose -> orange, voile radial pour donner du relief, gros texte blanc
 * centré qui s'adapte à la longueur du message.
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

  const marge = 90;
  const texteAffiche = retirerEmoji(texte) || "…";
  const { lignes, interligne } = ajusterTexte(ctx, texteAffiche, {
    largeurMax: LARGEUR - marge * 2,
    hauteurMax: hauteur - 100,
    police: "ChakraBold",
    tailleMax: 60,
    tailleMin: 26,
  });

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left"; // le centrage se calcule à la main : voir dashboardImage.js::ecrire, qui exige un dessin gauche->droite pour son détour "&"
  ctx.textBaseline = "middle";
  const depart = hauteur / 2 - ((lignes.length - 1) * interligne) / 2;
  lignes.forEach((ligne, i) => {
    const x = LARGEUR / 2 - largeur(ctx, ligne) / 2;
    ecrire(ctx, ligne, x, depart + i * interligne);
  });

  return canvas.toBuffer("image/png");
}

let compteurImages = 0;

/**
 * @returns {{ fichier: AttachmentBuilder, galerie: MediaGalleryBuilder }} prêts
 *   à être ajoutés à un ContainerBuilder (addMediaGalleryComponents) et au
 *   payload d'envoi (`files: [fichier]`).
 */
function buildCarteVisuelle(texte, { hauteur, texteAlternatif } = {}) {
  const buffer = dessinerCarte(texte, { hauteur });
  const nom = `confess-${++compteurImages}.png`;
  const fichier = new AttachmentBuilder(buffer, { name: nom, description: (texteAlternatif || texte).slice(0, 1024) });
  const galerie = new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${nom}`));
  return { fichier, galerie };
}

module.exports = { dessinerCarte, buildCarteVisuelle, retirerEmoji, LARGEUR };
