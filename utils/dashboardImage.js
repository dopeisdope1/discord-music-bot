const crypto = require("crypto");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

// Discord ne sait pas disposer du texte en colonnes : aucun composant (V2
// compris) n'offre de grille, tout est empilé verticalement. Les bots dont
// l'aide ressemble à un vrai tableau de bord (grille 3 colonnes, bordures
// colorées par catégorie, police custom) ne dessinent donc PAS leur menu avec
// du texte Discord : ils rendent une image et l'envoient en pièce jointe.
// C'est ce que fait ce module. L'image reste affichée DANS le Container
// Components V2 (MediaGallery), donc la couleur d'accent, les boutons et
// toute la navigation restent inchangés — seul le pavé de texte est remplacé.
//
// La police est embarquée dans le dépôt (assets/fonts, licence OFL) et pas
// prise sur le système : un VPS Linux nu n'a quasiment aucune police, le
// rendu serait différent de la machine de dev — ou vide.
const FONTS = path.join(__dirname, "..", "assets", "fonts");
GlobalFonts.registerFromPath(path.join(FONTS, "ChakraPetch-Bold.ttf"), "ChakraBold");
GlobalFonts.registerFromPath(path.join(FONTS, "ChakraPetch-SemiBold.ttf"), "ChakraSemi");
GlobalFonts.registerFromPath(path.join(FONTS, "ChakraPetch-Regular.ttf"), "ChakraRegular");

const THEME = {
  fond: "#0b0912",
  fondHaut: "#120e1c",
  cadre: "#241d38",
  carte: "#141020",
  carteBord: "#272036",
  carteEntete: "#1b1529",
  texte: "#e8e4f3",
  texteDoux: "#8b849f",
  texteFaible: "#635c78",
};

const LARGEUR = 1200;
const MARGE = 40;
const GOUTTIERE = 18;
const COLONNES = 3;

/**
 * Ajoute une opacité à une couleur hex. Coller directement le suffixe
 * ("#fff" + "26") produit "#fff26", que le moteur de rendu REFUSE en levant
 * une erreur : on normalise donc en 6 chiffres d'abord. Toute valeur
 * inattendue retombe sur un gris neutre plutôt que de faire planter un rendu
 * déclenché par une action déjà exécutée.
 */
function avecAlpha(couleur, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(couleur || "").trim());
  if (!m) return `#94a3b8${alpha}`;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex}${alpha}`;
}

/** Rectangle à coins arrondis (chemin seulement — à remplir/tracer ensuite). */
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

/** Coupe un texte à la largeur disponible, avec une ellipse s'il déborde. */
function tronquer(ctx, texte, largeurMax) {
  if (ctx.measureText(texte).width <= largeurMax) return texte;
  let coupe = texte;
  while (coupe.length > 1 && ctx.measureText(`${coupe}…`).width > largeurMax) {
    coupe = coupe.slice(0, -1);
  }
  return `${coupe.trimEnd()}…`;
}

/** Écrit un texte avec un espacement entre lettres (absent de l'API canvas). */
function texteEspace(ctx, texte, x, y, espacement) {
  let curseur = x;
  for (const lettre of texte) {
    ctx.fillText(lettre, curseur, y);
    curseur += ctx.measureText(lettre).width + espacement;
  }
  return curseur - x - espacement;
}
function largeurEspacee(ctx, texte, espacement) {
  let total = 0;
  for (const lettre of texte) total += ctx.measureText(lettre).width + espacement;
  return total - espacement;
}

/**
 * Hauteur d'une carte selon son nombre de lignes. Une carte sans titre (les
 * colonnes de commandes d'une catégorie ouverte) n'a pas de bandeau d'en-tête.
 */
function hauteurCarte(items, avecTitre = true, avecSousTitre = false) {
  const ENTETE = avecTitre ? 58 : 16;
  const LIGNE = 40;
  return ENTETE + (avecSousTitre ? 20 : 0) + Math.max(1, items.length) * LIGNE + 14;
}

/**
 * Découpe les cartes en rangées de 3. Une dernière rangée incomplète occupe
 * toute la largeur disponible (1 carte pleine largeur, 2 cartes à mi-largeur)
 * pour ne pas laisser un trou béant dans la grille.
 */
function disposer(cartes) {
  const rangees = [];
  for (let i = 0; i < cartes.length; i += COLONNES) rangees.push(cartes.slice(i, i + COLONNES));
  return rangees;
}

/**
 * @param {number} [hauteurImposee] hauteur commune à toute la rangée : sans
 *   elle, une carte à 3 lignes finirait plus haut que sa voisine à 4 et la
 *   grille aurait des bas de cartes en escalier.
 */
function dessinerCarte(ctx, carte, x, y, largeur, hauteurImposee) {
  const avecTitre = Boolean(carte.titre);
  const hauteur = hauteurImposee || hauteurCarte(carte.items, avecTitre, Boolean(carte.sousTitre));

  cheminArrondi(ctx, x, y, largeur, hauteur, 12);
  ctx.fillStyle = THEME.carte;
  ctx.fill();
  ctx.strokeStyle = THEME.carteBord;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  if (avecTitre) {
    // Bandeau d'en-tête + liseré vertical coloré : c'est ce qui distingue les
    // catégories les unes des autres, faute de pouvoir colorer un bloc de
    // texte Discord.
    ctx.save();
    cheminArrondi(ctx, x, y, largeur, hauteur, 12);
    ctx.clip();
    ctx.fillStyle = THEME.carteEntete;
    ctx.fillRect(x, y, largeur, 44);
    ctx.fillStyle = carte.couleur;
    ctx.fillRect(x, y, 4, 44);
    ctx.restore();

    ctx.font = "17px ChakraBold";
    ctx.fillStyle = carte.couleur;
    texteEspace(ctx, tronquer(ctx, carte.titre.toUpperCase(), largeur - 34), x + 18, y + 23, 1.1);
  }

  let ligneY = y + (avecTitre ? 44 + 26 : 30);
  if (carte.sousTitre) {
    ctx.font = "12px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    ctx.fillText(tronquer(ctx, carte.sousTitre, largeur - 36), x + 18, y + 60);
    ligneY += 20;
  }
  if (!carte.items.length) {
    ctx.font = "13px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    ctx.fillText(tronquer(ctx, carte.vide || "—", largeur - 36), x + 18, ligneY);
    return hauteur;
  }

  for (const item of carte.items) {
    // Pastille ronde colorée, comme les icônes de la référence — un emoji
    // Discord ne se dessine pas dans un canvas sans police emoji.
    // `couleurPastille` prime quand l'item porte une information propre (le
    // palier de permission), sinon la pastille reprend la teinte de la carte.
    const teinte = item.couleurPastille || carte.couleur;
    ctx.beginPath();
    ctx.arc(x + 28, ligneY + 1, 9, 0, Math.PI * 2);
    ctx.fillStyle = avecAlpha(teinte, "22");
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 28, ligneY + 1, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = teinte;
    ctx.fill();

    const texteX = x + 46;
    const dispo = largeur - (texteX - x) - 16;
    ctx.font = "15px ChakraBold";
    ctx.fillStyle = THEME.texte;
    ctx.fillText(tronquer(ctx, item.nom, dispo), texteX, ligneY - 6);

    if (item.description) {
      ctx.font = "12px ChakraRegular";
      ctx.fillStyle = THEME.texteDoux;
      ctx.fillText(tronquer(ctx, item.description, dispo), texteX, ligneY + 10);
    }
    ligneY += 40;
  }
  return hauteur;
}

/**
 * Rend le tableau de bord en PNG.
 * @param {object} spec
 * @param {string} spec.titre titre encadré en haut (ex. "CENTRE DE COMMANDES")
 * @param {string} spec.sousTitre ligne d'identité sous le titre
 * @param {{titre: string, couleur: string, items: {nom: string, description?: string}[], vide?: string}[]} spec.cartes
 * @param {string} [spec.pied]
 * @returns {Buffer} PNG
 */
function rendre(spec) {
  const rangees = disposer(spec.cartes);

  // Hauteur totale calculée AVANT de créer le canvas : la grille doit finir
  // au ras de la dernière carte, sinon l'image traîne une bande vide.
  const HAUT_ENTETE = 118;
  let hauteurGrille = 0;
  for (const rangee of rangees) {
    hauteurGrille += Math.max(...rangee.map((c) => hauteurCarte(c.items, Boolean(c.titre), Boolean(c.sousTitre)))) + GOUTTIERE;
  }
  const hauteur = HAUT_ENTETE + hauteurGrille + (spec.legende?.length ? 26 : 0) + (spec.pied ? 34 : 0) + MARGE - GOUTTIERE;

  const canvas = createCanvas(LARGEUR, hauteur);
  const ctx = canvas.getContext("2d");

  const degrade = ctx.createLinearGradient(0, 0, 0, hauteur);
  degrade.addColorStop(0, THEME.fondHaut);
  degrade.addColorStop(1, THEME.fond);
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, LARGEUR, hauteur);

  cheminArrondi(ctx, 14, 14, LARGEUR - 28, hauteur - 28, 18);
  ctx.strokeStyle = THEME.cadre;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textBaseline = "middle";

  // Titre encadré
  ctx.font = "27px ChakraBold";
  const largeurTitre = largeurEspacee(ctx, spec.titre.toUpperCase(), 2.4);
  const boiteL = largeurTitre + 40;
  cheminArrondi(ctx, MARGE, 44, boiteL, 46, 9);
  ctx.fillStyle = "#191327";
  ctx.fill();
  ctx.strokeStyle = "#332a4d";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = THEME.texte;
  texteEspace(ctx, spec.titre.toUpperCase(), MARGE + 20, 68, 2.4);

  ctx.font = "14px ChakraRegular";
  ctx.fillStyle = THEME.texteDoux;
  ctx.fillText(tronquer(ctx, spec.sousTitre, LARGEUR - MARGE * 2), MARGE + 2, 106);

  let y = HAUT_ENTETE;
  for (const rangee of rangees) {
    const pleineLargeur = LARGEUR - MARGE * 2;
    const largeurCarte = (pleineLargeur - GOUTTIERE * (COLONNES - 1)) / COLONNES;
    // Une rangée incomplète s'étale pour remplir la largeur, plutôt que de
    // laisser un vide à droite.
    const largeur = rangee.length === COLONNES ? largeurCarte : (pleineLargeur - GOUTTIERE * (rangee.length - 1)) / rangee.length;

    const hauteurRangee = Math.max(...rangee.map((c) => hauteurCarte(c.items, Boolean(c.titre), Boolean(c.sousTitre))));
    let x = MARGE;
    for (const carte of rangee) {
      // `hauteursLibres` : chaque colonne prend sa hauteur réelle au lieu de
      // s'aligner sur la plus haute. Indispensable quand les colonnes sont
      // très inégales (un palier à 1 commande à côté d'un palier à 9) —
      // sinon la courte devient un grand rectangle vide.
      dessinerCarte(ctx, carte, x, y, largeur, spec.hauteursLibres ? undefined : hauteurRangee);
      x += largeur + GOUTTIERE;
    }
    y += hauteurRangee + GOUTTIERE;
  }

  // Légende : les pastilles sont DESSINÉES, pas écrites — la police
  // embarquée n'a pas de glyphe rond ("●" sortirait en carré vide).
  if (spec.legende?.length) {
    ctx.font = "13px ChakraRegular";
    const ESPACE = 26;
    const largeurTotale = spec.legende.reduce((somme, e) => somme + 12 + 6 + ctx.measureText(e.texte).width + ESPACE, 0) - ESPACE;
    let lx = (LARGEUR - largeurTotale) / 2;
    for (const entree of spec.legende) {
      ctx.beginPath();
      ctx.arc(lx + 5, y + 6, 5, 0, Math.PI * 2);
      ctx.fillStyle = entree.couleur;
      ctx.fill();
      ctx.fillStyle = THEME.texteDoux;
      ctx.fillText(entree.texte, lx + 17, y + 6);
      lx += 12 + 6 + ctx.measureText(entree.texte).width + ESPACE;
    }
    y += 26;
  }

  if (spec.pied) {
    ctx.font = "13px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    const l = ctx.measureText(spec.pied).width;
    ctx.fillText(spec.pied, (LARGEUR - l) / 2, y + 6);
  }

  return canvas.toBuffer("image/png");
}

// L'image ne dépend QUE de la spec (donc des droits réels du membre, du
// préfixe et de la catégorie ouverte) : mettre en cache par empreinte de la
// spec est exact — deux membres aux mêmes droits partagent le même rendu,
// et un changement de droits produit une empreinte différente. Le VPS est
// petit (458 Mo), d'où un cache borné en nombre d'entrées, le plus ancien
// évincé en premier.
const CACHE_MAX = 40;
const cache = new Map();

function rendreEnCache(spec) {
  const cle = crypto.createHash("sha1").update(JSON.stringify(spec)).digest("hex");
  const connu = cache.get(cle);
  if (connu) {
    // Remis en tête : le plus récemment servi survit à l'éviction.
    cache.delete(cle);
    cache.set(cle, connu);
    return connu;
  }
  const png = rendre(spec);
  cache.set(cle, png);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return png;
}

/**
 * Première proposition d'une description : les descriptions du catalogue et
 * des rubriques sont écrites pour un écran détaillé (elles précisent les
 * options, les alias, les renvois) et se retrouvent coupées net dans une
 * carte. On garde la partie utile avant la première parenthèse, le premier
 * point ou le premier deux-points. Le texte reste celui de la source, jamais
 * réécrit.
 */
function resumer(texte) {
  if (!texte) return undefined;
  return texte.split(" (")[0].split(/\.\s/)[0].split(" : ")[0].trim();
}

module.exports = { rendre, rendreEnCache, resumer, LARGEUR };
