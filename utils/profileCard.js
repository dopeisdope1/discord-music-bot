const { createCanvas } = require("@napi-rs/canvas");
const { AttachmentBuilder } = require("discord.js");
const { ecrire, largeur } = require("./dashboardImage");
const { avatarDe, nomDe, prechargerAvatar } = require("./actionCard");

// Cartes &boost et &profil, dessinées dans le style sombre de Discord.
//
// Pourquoi une image plutôt qu'un embed : la mise en page voulue (barre de
// progression, colonne de paliers alignée, pastilles de niveau) n'existe pas
// en composants Discord. Même raison que le tableau de bord de &help.
//
// LES BADGES SONT DESSINÉS, jamais recopiés. Les médailles Nitro et Boost sont
// les assets de marque de Discord : les embarquer dans le dépôt pour les
// réémettre serait les redistribuer. Les formes ci-dessous s'en inspirent dans
// l'esprit (une géométrie qui se complexifie avec l'ancienneté) sans en être
// une copie.

const LARGEUR = 900;
const MARGE = 40;

// Les gris de Discord en thème sombre, relevés sur les captures.
const THEME = {
  fond: "#2b2d31",
  fondCarte: "#313338",
  bordure: "#3f4147",
  filet: "#4e5058",
  texte: "#f2f3f5",
  texteDoux: "#b5bac1",
  texteFaible: "#949ba4",
  surlignage: "#404249",
  barreVide: "#4e5058",
};
// Le rose des boosts, la seule teinte de ces cartes.
const ROSE = "#ff73fa";
const ROSE_SOMBRE = "#c45ee0";

const AVATAR = 96;

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

/**
 * Pastille de palier. Chaque forme est tracée à la main, centrée sur (cx, cy)
 * et inscrite dans un carré de `taille` — voir le commentaire d'en-tête sur
 * les assets de Discord.
 */
function dessinerForme(ctx, forme, cx, cy, taille, atteint) {
  const r = taille / 2;
  ctx.save();
  ctx.fillStyle = atteint ? ROSE : "#5c5e66";
  ctx.strokeStyle = atteint ? ROSE_SOMBRE : "#4e5058";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  switch (forme) {
    case "triangle":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.8);
      ctx.lineTo(cx - r, cy + r * 0.8);
      break;
    case "losange":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      break;
    case "losange-long":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.62, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 0.62, cy);
      break;
    case "carre":
      ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
      break;
    case "hexagone":
    case "hexagone-plein":
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      break;
    case "etoile":
      for (let i = 0; i < 10; i++) {
        const rayon = i % 2 ? r * 0.45 : r;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = cx + rayon * Math.cos(a);
        const py = cy + rayon * Math.sin(a);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      break;
    case "cristal":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.7, cy - r * 0.2);
      ctx.lineTo(cx + r * 0.45, cy + r);
      ctx.lineTo(cx - r * 0.45, cy + r);
      ctx.lineTo(cx - r * 0.7, cy - r * 0.2);
      break;
    case "diamant":
    default:
      ctx.moveTo(cx - r * 0.6, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.6, cy - r * 0.55);
      ctx.lineTo(cx + r, cy - r * 0.05);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy - r * 0.05);
      break;
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Un palier déjà franchi est plein ; les autres restent en creux, pour que
  // l'avancement se lise sans avoir à comparer les dates une à une.
  if (!atteint) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.stroke();
  }
  ctx.restore();
}

/** Barre de progression, dans les proportions de celles de Discord. */
function dessinerBarre(ctx, x, y, l, pourcentage) {
  const h = 8;
  cheminArrondi(ctx, x, y - h / 2, l, h, h / 2);
  ctx.fillStyle = THEME.barreVide;
  ctx.fill();
  const remplie = Math.max(0, Math.min(1, pourcentage / 100)) * l;
  if (remplie > 0) {
    cheminArrondi(ctx, x, y - h / 2, Math.max(h, remplie), h, h / 2);
    ctx.fillStyle = ROSE;
    ctx.fill();
  }
  // Le pourcentage dans sa pastille, à droite de la barre.
  ctx.font = "16px ChakraBold";
  const etiquette = `${Math.round(pourcentage)}%`;
  const l2 = largeur(ctx, etiquette) + 18;
  cheminArrondi(ctx, x + l + 12, y - 13, l2, 26, 6);
  ctx.fillStyle = THEME.surlignage;
  ctx.fill();
  ctx.fillStyle = THEME.texte;
  ecrire(ctx, etiquette, x + l + 21, y);
}

/** Titre de section, en capitales espacées comme sur les captures. */
function dessinerSection(ctx, titre, y) {
  ctx.strokeStyle = THEME.bordure;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGE, y - 26);
  ctx.lineTo(LARGEUR - MARGE, y - 26);
  ctx.stroke();
  ctx.font = "24px ChakraBold";
  ctx.fillStyle = THEME.texte;
  ecrire(ctx, titre.toUpperCase(), MARGE, y);
}

/** Le filet vertical qui marque un bloc cité, comme les blockquotes Discord. */
function filet(ctx, y, hauteur) {
  ctx.fillStyle = THEME.filet;
  ctx.fillRect(MARGE, y, 3, hauteur);
}

/**
 * Avatar rond. Sans image (aucun avatar, ou téléchargement en échec), on
 * dessine la silhouette grisée demandée plutôt que de laisser un trou.
 */
function dessinerAvatar(ctx, image, x, y) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + AVATAR / 2, y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, x, y, AVATAR, AVATAR);
  } else {
    ctx.fillStyle = "#4e5058";
    ctx.fillRect(x, y, AVATAR, AVATAR);
    ctx.fillStyle = "#6d6f78";
    ctx.beginPath();
    ctx.arc(x + AVATAR / 2, y + AVATAR * 0.38, AVATAR * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + AVATAR / 2, y + AVATAR * 0.92, AVATAR * 0.3, Math.PI, 0);
    ctx.fill();
  }
  ctx.restore();
}

/** Une ligne « Label : valeur », la valeur sur fond surligné comme sur Discord. */
function ligneValeur(ctx, label, valeur, x, y) {
  ctx.font = "18px ChakraBold";
  ctx.fillStyle = THEME.texte;
  ecrire(ctx, label, x, y);
  let curseur = x + largeur(ctx, label);
  ctx.font = "18px ChakraRegular";
  const l = largeur(ctx, valeur);
  cheminArrondi(ctx, curseur + 6, y - 13, l + 12, 26, 4);
  ctx.fillStyle = THEME.surlignage;
  ctx.fill();
  ctx.fillStyle = THEME.texteDoux;
  ecrire(ctx, valeur, curseur + 12, y);
}

/**
 * Carte &boost.
 * @param {object} spec
 * @param {string} spec.nom pseudo affiché
 * @param {object|null} spec.progression sortie de boostProgress.progression()
 * @param {import('@napi-rs/canvas').Image|null} spec.avatar
 * @param {(d: Date) => string} spec.relatif
 * @param {(d: Date) => string} spec.dateCourte
 * @param {(d: Date) => string} spec.dateLongue
 */
function dessinerBoost(spec) {
  const p = spec.progression;
  const canvas = createCanvas(LARGEUR, HAUTEUR_TOILE);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";

  ctx.fillStyle = THEME.fond;
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR_TOILE);
  // Le liseré rose à gauche, comme la barre d'accent d'un embed Discord.
  ctx.fillStyle = ROSE;
  ctx.fillRect(0, 0, 5, HAUTEUR_TOILE);

  ctx.font = "38px ChakraBold";
  ctx.fillStyle = THEME.texte;
  ecrire(ctx, `Progression Boost de ${spec.nom}`, MARGE, 62);
  dessinerAvatar(ctx, spec.avatar, LARGEUR - MARGE - AVATAR, 26);

  let y = 118;
  if (!p) {
    filet(ctx, y - 18, 40);
    ctx.font = "18px ChakraRegular";
    ctx.fillStyle = THEME.texteDoux;
    ecrire(ctx, `${spec.nom} ne booste pas ce serveur.`, MARGE + 16, y);
    ecrire(ctx, "Discord ne communique la date qu'à partir du premier boost.", MARGE + 16, y + 24);
    return recadrer(canvas, y + 44);
  }

  filet(ctx, y - 20, 62);
  ligneValeur(ctx, "Début du boost : ", spec.dateLongue(p.debut), MARGE + 16, y);
  ligneValeur(ctx, "Ancienneté : ", `${p.moisEcoules} mois`, MARGE + 16, y + 30);

  y += 96;
  dessinerSection(ctx, "Badge actuel", y);
  y += 40;
  filet(ctx, y - 18, 36);
  dessinerForme(ctx, p.paliers.find((x) => x.mois === p.palierActuel).forme, MARGE + 34, y, 22, true);
  ligneValeur(ctx, `${p.palierActuel} mois : `, spec.relatif(p.paliers.find((x) => x.mois === p.palierActuel).date), MARGE + 54, y);

  y += 64;
  dessinerSection(ctx, "Prochaine évolution", y);
  y += 40;
  filet(ctx, y - 18, 36);
  if (p.palierSuivant === null) {
    ctx.font = "18px ChakraRegular";
    ctx.fillStyle = THEME.texteDoux;
    ecrire(ctx, "Dernier palier atteint — il n'y a plus rien après 24 mois.", MARGE + 16, y);
  } else {
    dessinerForme(ctx, p.paliers.find((x) => x.mois === p.palierSuivant).forme, MARGE + 34, y, 22, false);
    ligneValeur(ctx, `${p.palierSuivant} mois : `, spec.relatif(p.dateSuivante), MARGE + 54, y);
  }

  y += 64;
  dessinerSection(ctx, "Progression", y);
  y += 42;
  dessinerBarre(ctx, MARGE + 16, y, LARGEUR - MARGE * 2 - 110, p.pourcentage);

  y += 56;
  dessinerSection(ctx, "Historique", y);
  y += 34;
  filet(ctx, y - 16, p.paliers.length * 34);
  for (const palier of p.paliers) {
    y += 34;
    dessinerForme(ctx, palier.forme, MARGE + 34, y - 17, 20, palier.atteint);
    ctx.font = "18px ChakraBold";
    ctx.fillStyle = palier.atteint ? THEME.texte : THEME.texteFaible;
    const label = `${palier.mois} mois`;
    ecrire(ctx, label, MARGE + 54, y - 17);
    ctx.font = "18px ChakraRegular";
    ctx.fillStyle = THEME.texteDoux;
    ecrire(ctx, `${spec.dateCourte(palier.date)}  (${spec.relatif(palier.date)})`, MARGE + 54 + 90, y - 17);
  }

  return recadrer(canvas, y + MARGE);
}

/**
 * Carte &profil.
 * @param {object} spec
 * @param {string} spec.nom
 * @param {string} spec.identifiant
 * @param {string} spec.mention forme « @pseudo », jamais `<@id>` (le canvas ne résout pas les mentions)
 * @param {string} spec.creation
 * @param {object|null} spec.progression
 * @param {string[]} spec.serveurs serveurs en commun avec le bot
 */
function dessinerProfil(spec) {
  const p = spec.progression;
  const serveurs = spec.serveurs.slice(0, 6);
  const canvas = createCanvas(LARGEUR, HAUTEUR_TOILE);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";

  ctx.fillStyle = THEME.fond;
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR_TOILE);
  ctx.fillStyle = p ? ROSE : THEME.filet;
  ctx.fillRect(0, 0, 5, HAUTEUR_TOILE);

  ctx.font = "38px ChakraBold";
  ctx.fillStyle = THEME.texte;
  ecrire(ctx, `Profil de ${spec.nom}`, MARGE, 62);
  dessinerAvatar(ctx, spec.avatar, LARGEUR - MARGE - AVATAR, 26);

  let y = 118;
  filet(ctx, y - 20, 92);
  ligneValeur(ctx, "Utilisateur : ", spec.mention, MARGE + 16, y);
  ligneValeur(ctx, "Identifiant : ", spec.identifiant, MARGE + 16, y + 30);
  ligneValeur(ctx, "Compte créé : ", spec.creation, MARGE + 16, y + 60);

  y += 126;
  dessinerSection(ctx, "Boost", y);
  y += 40;
  filet(ctx, y - 18, p ? 96 : 36);
  if (!p) {
    ctx.font = "18px ChakraRegular";
    ctx.fillStyle = THEME.texteDoux;
    ecrire(ctx, "Ne booste pas ce serveur.", MARGE + 16, y);
    y += 40;
  } else {
    dessinerForme(ctx, p.paliers.find((x) => x.mois === p.palierActuel).forme, MARGE + 34, y, 22, true);
    ligneValeur(ctx, `Boost : `, `${p.moisEcoules} mois`, MARGE + 54, y);
    ctx.font = "18px ChakraBold";
    ctx.fillStyle = THEME.texte;
    ecrire(ctx, "Suivant : ", MARGE + 16, y + 30);
    ctx.font = "18px ChakraRegular";
    ctx.fillStyle = THEME.texteDoux;
    ecrire(
      ctx,
      p.palierSuivant === null ? "dernier palier atteint" : `${p.palierSuivant} mois, ${spec.relatif(p.dateSuivante)}`,
      MARGE + 16 + largeur(ctx, "Suivant : ") + 12,
      y + 30
    );
    y += 66;
    dessinerBarre(ctx, MARGE + 16, y, LARGEUR - MARGE * 2 - 110, p.pourcentage);
    y += 40;
  }

  y += 44;
  dessinerSection(ctx, "Serveurs en commun", y);
  y += 30;
  filet(ctx, y - 14, Math.max(1, serveurs.length) * 28);
  if (!serveurs.length) {
    y += 28;
    ctx.font = "18px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    ecrire(ctx, "Aucun autre serveur en commun avec le bot.", MARGE + 16, y - 14);
  } else {
    for (const nom of serveurs) {
      y += 28;
      ctx.fillStyle = THEME.texteFaible;
      ctx.beginPath();
      ctx.arc(MARGE + 24, y - 14, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "18px ChakraRegular";
      ctx.fillStyle = THEME.texteDoux;
      ecrire(ctx, nom, MARGE + 38, y - 14);
    }
  }

  return recadrer(canvas, y + MARGE);
}

/**
 * Recadre le dessin sur sa hauteur RÉELLE.
 *
 * Calculer la hauteur à l'avance obligeait à recopier, dans une formule, la
 * suite des `y +=` du corps de la fonction. Les deux ont dérivé dès la
 * première retouche et l'historique se retrouvait coupé en plein milieu. On
 * dessine donc dans une toile large, on note où le tracé s'arrête, et on
 * recadre — il n'y a plus qu'une seule source de vérité, le tracé lui-même.
 */
function recadrer(canvas, basY) {
  const hauteur = Math.min(canvas.height, Math.ceil(basY));
  const final = createCanvas(canvas.width, hauteur);
  final.getContext("2d").drawImage(canvas, 0, 0);
  return final.toBuffer("image/png");
}

// Assez haut pour n'importe quelle carte (24 mois d'historique + profil
// complet), jamais visible : tout est recadré avant l'envoi.
const HAUTEUR_TOILE = 1400;

/** Enrobe un PNG en pièce jointe nommée. */
const enFichier = (png, nom) => new AttachmentBuilder(png, { name: nom });

module.exports = { dessinerBoost, dessinerProfil, enFichier, avatarDe, nomDe, prechargerAvatar, LARGEUR, PALETTE: THEME, ROSE };
