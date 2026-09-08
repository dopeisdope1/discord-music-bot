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
// Rajdhani (OFL, même esprit technique) sert UNIQUEMENT d'esperluette de
// secours — voir ecrire() plus bas.
// Deux graisses, appariées à celles de Chakra Petch : une esperluette maigre
// à côté d'un texte gras se verrait autant que le « 8 » qu'elle remplace.
GlobalFonts.registerFromPath(path.join(FONTS, "Rajdhani-Bold.ttf"), "AmpBold");
GlobalFonts.registerFromPath(path.join(FONTS, "Rajdhani-Medium.ttf"), "AmpRegular");

// Chakra Petch dessine l'esperluette comme un « 8 » barré. Le préfixe du bot
// ÉTANT « & », tout ce que l'image annonçait se lisait « 8kick », « 8ban »,
// « Préfixe : 8 » — soit un préfixe qui ne ressemblait pas à celui qu'on tape.
//
// On emprunte donc CE SEUL caractère à une police de secours, sans toucher au
// reste : changer de police pour tout le tableau de bord aurait changé son
// allure pour corriger un glyphe.
const CARACTERE_EMPRUNTE = "&";
const SECOURS_PAR_POLICE = { ChakraBold: "AmpBold", ChakraSemi: "AmpBold", ChakraRegular: "AmpRegular" };

/** La même déclaration de police, avec la famille de secours. `null` si la police courante n'en a pas. */
function policeDeSecours(font) {
  const declaration = String(font || "").trim();
  const famille = declaration.split(/\s+/).pop();
  const secours = SECOURS_PAR_POLICE[famille];
  return secours ? `${declaration.slice(0, declaration.length - famille.length)}${secours}` : null;
}

/**
 * Découpe un texte en tronçons, en isolant les caractères empruntés.
 * @returns {{texte: string, emprunte: boolean}[]}
 */
function troncons(texte) {
  return String(texte ?? "")
    .split(new RegExp(`(${CARACTERE_EMPRUNTE})`))
    .filter(Boolean)
    .map((t) => ({ texte: t, emprunte: t === CARACTERE_EMPRUNTE }));
}

/**
 * `fillText` qui dessine l'esperluette dans la police de secours. À utiliser
 * PARTOUT à la place de ctx.fillText : un seul appel oublié et le « 8 »
 * réapparaît à cet endroit-là.
 */
function ecrire(ctx, texte, x, y) {
  const t = String(texte ?? "");
  const alternative = t.includes(CARACTERE_EMPRUNTE) ? policeDeSecours(ctx.font) : null;
  if (!alternative) return ctx.fillText(t, x, y); // détour-ok
  const origine = ctx.font;
  let curseur = x;
  for (const tronçon of troncons(t)) {
    ctx.font = tronçon.emprunte ? alternative : origine;
    ctx.fillText(tronçon.texte, curseur, y); // détour-ok
    curseur += ctx.measureText(tronçon.texte).width; // détour-ok
  }
  ctx.font = origine;
}

/**
 * `measureText(...).width` équivalent : la largeur réellement occupée une fois
 * l'esperluette empruntée. Sans elle, la troncature et les centrages
 * calculeraient sur une largeur qui n'est pas celle dessinée.
 */
function largeur(ctx, texte) {
  const t = String(texte ?? "");
  const alternative = t.includes(CARACTERE_EMPRUNTE) ? policeDeSecours(ctx.font) : null;
  if (!alternative) return ctx.measureText(t).width; // détour-ok
  const origine = ctx.font;
  let total = 0;
  for (const tronçon of troncons(t)) {
    ctx.font = tronçon.emprunte ? alternative : origine;
    total += ctx.measureText(tronçon.texte).width; // détour-ok
  }
  ctx.font = origine;
  return total;
}

// Gris PURS, sans la moindre teinte : demande explicite, et les gris violacés
// précédents se lisaient encore comme une couleur.
//
// L'autre moitié du problème était le contraste. Discord réduit l'image à
// ~500 px de large : un gris à 4,5:1 sur fond sombre, une fois écrasé de
// moitié, devient illisible. Les descriptions sont donc nettement éclaircies
// (~9:1), pas seulement désaturées.
const THEME = {
  fond: "#0e0e0e",
  fondHaut: "#161616",
  cadre: "#3a3a3a",
  carte: "#1a1a1a",
  carteBord: "#3a3a3a",
  carteEntete: "#242424",
  texte: "#ffffff",
  texteDoux: "#c4c4c4",
  texteFaible: "#9a9a9a",
};

// Discord réduit une image jointe à ~500 px de large dans le fil : plus
// l'image est large, plus le texte est écrasé à l'affichage. Une image de
// 1200 px sur 3 colonnes rendait des libellés de 12 px à ~5 px — illisible
// sans zoomer. On dessine donc PLUS ÉTROIT avec de PLUS GROSSES polices :
// c'est le rapport texte/largeur qui décide de la lisibilité finale.
const LARGEUR = 880;
const MARGE = 34;
const GOUTTIERE = 16;
const COLONNES = 2;

/**
 * Ajoute une opacité à une couleur hex. Coller directement le suffixe
 * ("#fff" + "26") produit "#fff26", que le moteur de rendu REFUSE en levant
 * une erreur : on normalise donc en 6 chiffres d'abord. Toute valeur
 * inattendue retombe sur un gris neutre plutôt que de faire planter un rendu
 * déclenché par une action déjà exécutée.
 */
function avecAlpha(couleur, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(couleur || "").trim());
  if (!m) return `#c4c4c4${alpha}`;
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
  if (largeur(ctx, texte) <= largeurMax) return texte;
  let coupe = texte;
  while (coupe.length > 1 && largeur(ctx, `${coupe}…`) > largeurMax) {
    coupe = coupe.slice(0, -1);
  }
  return `${coupe.trimEnd()}…`;
}

/** Écrit un texte avec un espacement entre lettres (absent de l'API canvas). */
function texteEspace(ctx, texte, x, y, espacement) {
  let curseur = x;
  for (const lettre of texte) {
    ecrire(ctx, lettre, curseur, y);
    curseur += largeur(ctx, lettre) + espacement;
  }
  return curseur - x - espacement;
}
function largeurEspacee(ctx, texte, espacement) {
  let total = 0;
  for (const lettre of texte) total += largeur(ctx, lettre) + espacement;
  return total - espacement;
}

/**
 * Hauteur d'une carte selon son nombre de lignes. Une carte sans titre (les
 * colonnes de commandes d'une catégorie ouverte) n'a pas de bandeau d'en-tête.
 */
function hauteurCarte(items, avecTitre = true, avecSousTitre = false) {
  const ENTETE = avecTitre ? 64 : 20;
  const LIGNE = 50;
  return ENTETE + (avecSousTitre ? 24 : 0) + Math.max(1, items.length) * LIGNE + 16;
}

/**
 * Découpe les cartes en rangées de 3. Une dernière rangée incomplète occupe
 * toute la largeur disponible (1 carte pleine largeur, 2 cartes à mi-largeur)
 * pour ne pas laisser un trou béant dans la grille.
 */
function disposer(cartes, colonnes = COLONNES) {
  const rangees = [];
  for (let i = 0; i < cartes.length; i += colonnes) rangees.push(cartes.slice(i, i + colonnes));
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
    ctx.fillRect(x, y, largeur, 50);
    ctx.fillStyle = carte.couleur;
    ctx.fillRect(x, y, 5, 50);
    ctx.restore();

    ctx.font = "22px ChakraBold";
    ctx.fillStyle = carte.couleur;
    texteEspace(ctx, tronquer(ctx, carte.titre.toUpperCase(), largeur - 36), x + 18, y + 26, 1.1);
  }

  let ligneY = y + (avecTitre ? 50 + 30 : 32);
  if (carte.sousTitre) {
    ctx.font = "15px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    ecrire(ctx, tronquer(ctx, carte.sousTitre, largeur - 36), x + 18, y + 68);
    ligneY += 24;
  }
  if (!carte.items.length) {
    ctx.font = "13px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    ecrire(ctx, tronquer(ctx, carte.vide || "—", largeur - 36), x + 18, ligneY);
    return hauteur;
  }

  for (const item of carte.items) {
    // Pastille ronde colorée, comme les icônes de la référence — un emoji
    // Discord ne se dessine pas dans un canvas sans police emoji.
    // `couleurPastille` prime quand l'item porte une information propre (le
    // palier de permission), sinon la pastille reprend la teinte de la carte.
    const teinte = item.couleurPastille || carte.couleur;
    ctx.beginPath();
    ctx.arc(x + 30, ligneY + 1, 10, 0, Math.PI * 2);
    ctx.fillStyle = avecAlpha(teinte, "22");
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 30, ligneY + 1, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = teinte;
    ctx.fill();

    const texteX = x + 52;
    const dispo = largeur - (texteX - x) - 16;
    ctx.font = "20px ChakraBold";
    ctx.fillStyle = THEME.texte;
    ecrire(ctx, tronquer(ctx, item.nom, dispo), texteX, ligneY - 8);

    if (item.description) {
      ctx.font = "16px ChakraRegular";
      ctx.fillStyle = THEME.texteDoux;
      ecrire(ctx, tronquer(ctx, item.description, dispo), texteX, ligneY + 12);
    }
    ligneY += 50;
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
  // Une rubrique de réglages (5 lignes « Label : valeur ») se lit bien mieux
  // sur UNE colonne pleine largeur que coupée en deux demi-colonnes où chaque
  // valeur se fait tronquer. L'appelant décide ; deux colonnes restent la
  // valeur par défaut, celle des grilles de &help et de l'accueil du panel.
  const colonnes = Math.max(1, spec.colonnes || COLONNES);
  const rangees = disposer(spec.cartes, colonnes);

  // Hauteur totale calculée AVANT de créer le canvas : la grille doit finir
  // au ras de la dernière carte, sinon l'image traîne une bande vide.
  const HAUT_ENTETE = 132;
  let hauteurGrille = 0;
  for (const rangee of rangees) {
    hauteurGrille += Math.max(...rangee.map((c) => hauteurCarte(c.items, Boolean(c.titre), Boolean(c.sousTitre)))) + GOUTTIERE;
  }
  // Le bandeau d'état et chaque alerte repoussent la grille vers le bas.
  const hauteurEntete = HAUT_ENTETE + (spec.banniere ? 26 : 0) + (spec.alertes?.length || 0) * 24;
  const hauteur = hauteurEntete + hauteurGrille + (spec.legende?.length ? 26 : 0) + (spec.pied ? 34 : 0) + MARGE - GOUTTIERE;

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
  ctx.font = "30px ChakraBold";
  const largeurTitre = largeurEspacee(ctx, spec.titre.toUpperCase(), 2.4);
  const boiteL = largeurTitre + 44;
  cheminArrondi(ctx, MARGE, 42, boiteL, 52, 10);
  ctx.fillStyle = THEME.carteEntete;
  ctx.fill();
  ctx.strokeStyle = THEME.cadre;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = THEME.texte;
  texteEspace(ctx, spec.titre.toUpperCase(), MARGE + 22, 68, 2.4);

  ctx.font = "17px ChakraRegular";
  ctx.fillStyle = THEME.texteDoux;
  ecrire(ctx, tronquer(ctx, spec.sousTitre, LARGEUR - MARGE * 2), MARGE + 2, 112);

  // Bandeau d'état et alertes de sécurité, DESSINÉS : en texte Discord, une
  // mention citée dans une alerte (« @everyone possède… ») sortait en
  // pastille et pouvait notifier le serveur. Ici elle ne peut plus.
  let yEntete = 112;
  if (spec.banniere) {
    yEntete += 26;
    ctx.beginPath();
    ctx.arc(MARGE + 7, yEntete, 5, 0, Math.PI * 2);
    ctx.fillStyle = THEME.texte;
    ctx.fill();
    ctx.font = "16px ChakraRegular";
    ctx.fillStyle = THEME.texte;
    ecrire(ctx, tronquer(ctx, spec.banniere, LARGEUR - MARGE * 2 - 24), MARGE + 22, yEntete);
  }
  for (const alerte of spec.alertes || []) {
    yEntete += 24;
    ctx.beginPath();
    ctx.arc(MARGE + 7, yEntete, 5, 0, Math.PI * 2);
    // La gravité n'est plus portée par une couleur : le texte de l'alerte dit
    // déjà ce qui cloche, et `&security scan` reste la vue détaillée.
    ctx.fillStyle = THEME.texteDoux;
    ctx.fill();
    ctx.font = "15px ChakraRegular";
    ctx.fillStyle = THEME.texteDoux;
    ecrire(ctx, tronquer(ctx, alerte.texte, LARGEUR - MARGE * 2 - 24), MARGE + 22, yEntete);
  }

  let y = hauteurEntete;
  for (const rangee of rangees) {
    const pleineLargeur = LARGEUR - MARGE * 2;
    const largeurCarte = (pleineLargeur - GOUTTIERE * (colonnes - 1)) / colonnes;
    // Une rangée incomplète s'étale pour remplir la largeur, plutôt que de
    // laisser un vide à droite.
    const largeur = rangee.length === colonnes ? largeurCarte : (pleineLargeur - GOUTTIERE * (rangee.length - 1)) / rangee.length;

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
    ctx.font = "14px ChakraRegular";
    const ESPACE = 24;
    const largeurTotale = spec.legende.reduce((somme, e) => somme + 12 + 6 + largeur(ctx, e.texte) + ESPACE, 0) - ESPACE;
    let lx = (LARGEUR - largeurTotale) / 2;
    for (const entree of spec.legende) {
      ctx.beginPath();
      ctx.arc(lx + 5, y + 6, 5, 0, Math.PI * 2);
      ctx.fillStyle = entree.couleur;
      ctx.fill();
      ctx.fillStyle = THEME.texteDoux;
      ecrire(ctx, entree.texte, lx + 17, y + 6);
      lx += 12 + 6 + largeur(ctx, entree.texte) + ESPACE;
    }
    y += 26;
  }

  if (spec.pied) {
    ctx.font = "14px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    const l = largeur(ctx, spec.pied);
    ecrire(ctx, spec.pied, (LARGEUR - l) / 2, y + 6);
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
  let png;
  try {
    png = rendre(spec);
  } catch (err) {
    // Un dessin raté ne doit pas SUPPRIMER la commande : &help et &panel
    // sont la seule façon de découvrir ce que fait le bot, et leur contenu
    // existe déjà entièrement dans la spec. L'appelant retombe donc sur
    // enTexte() plutôt que de ne rien afficher — même principe que les
    // cartes de sanction (utils/actionCard.js), où le rendu qui échoue rend
    // la main au message texte.
    console.error("[dashboardImage] rendu impossible :", err);
    return null;
  }
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

// Discord plafonne le texte affichable de TOUS les composants d'un message
// CUMULÉ à 4000 caractères (voir le commentaire de MAX_CHUNKS_PER_PAGE dans
// utils/helpPanel.js, où la vraie erreur d'API est recopiée). Le repli tient
// dans un seul TextDisplay : on vise sous ce plafond, avec de la marge pour
// l'en-tête et la navigation qui partagent le même budget.
const BUDGET_TEXTE = 3600;

/**
 * La MÊME spec, en texte Discord. Sert de repli quand l'image ne peut pas
 * être dessinée (rendreEnCache a renvoyé null) ou pas être envoyée (le bot
 * n'a pas « Joindre des fichiers » dans le salon). C'est moins joli — pas de
 * grille, pas de couleur par catégorie, c'est justement pour ça que l'image
 * existe — mais la commande reste utilisable, ce qui compte davantage.
 *
 * Les pastilles de palier ne sont PAS transposées : leur sens vient de la
 * légende dessinée, et rendre les deux en texte doublerait la longueur pour
 * une information que la vue détaillée d'une catégorie donne déjà.
 *
 * Défensive de bout en bout : elle est justement appelée quand quelque chose
 * a déjà mal tourné, un champ absent ne doit pas la faire échouer à son tour.
 */
function enTexte(spec, budget = BUDGET_TEXTE) {
  const s = spec || {};
  const lignes = [`## 「 ${String(s.titre || "Tableau de bord").toUpperCase()} 」`];
  if (s.sousTitre) lignes.push(`> ${s.sousTitre}`);

  let coupe = false;
  const longueur = () => lignes.join("\n").length;
  const ajouter = (ligne) => {
    if (coupe) return;
    // -80 : de quoi loger la mention de coupe et le pied sans repasser au-dessus.
    if (longueur() + ligne.length + 1 > budget - 80) {
      coupe = true;
      return;
    }
    lignes.push(ligne);
  };

  for (const carte of s.cartes || []) {
    ajouter("");
    if (carte.titre) ajouter(`### ${carte.titre}`);
    if (carte.sousTitre) ajouter(`-# ${carte.sousTitre}`);
    if (!carte.items?.length) {
      ajouter(carte.vide || "—");
      continue;
    }
    for (const item of carte.items) {
      ajouter(item.description ? `\`${item.nom}\` — ${item.description}` : `\`${item.nom}\``);
    }
  }

  // Dire que la liste est tronquée, plutôt que de la laisser s'arrêter net :
  // sans ça, une catégorie absente passerait pour une catégorie inexistante.
  if (coupe) lignes.push("", "-# Liste raccourcie — ouvre une catégorie dans le menu pour la voir en entier.");
  if (s.pied) lignes.push("", `-# ${s.pied}`);
  return lignes.join("\n");
}

module.exports = { rendre, rendreEnCache, resumer, enTexte, ecrire, largeur, LARGEUR };
