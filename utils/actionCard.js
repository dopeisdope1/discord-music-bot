const { createCanvas, loadImage } = require("@napi-rs/canvas");
const { AttachmentBuilder } = require("discord.js");

// Carte d'action en image : « untel a reçu le rôle X », « untel a été banni ».
// Même monde visuel que le tableau de bord de &help/&panel
// (utils/dashboardImage.js, mêmes polices déjà enregistrées par ce module —
// d'où le require ci-dessous, qui n'est pas décoratif : il déclenche
// l'enregistrement des polices Chakra Petch).
require("./dashboardImage");

const THEME = {
  fond: "#0b0912",
  fondHaut: "#141020",
  cadre: "#241d38",
  texte: "#e8e4f3",
  texteDoux: "#8b849f",
  texteFaible: "#635c78",
};

const LARGEUR = 900;
const MARGE = 34;
const AVATAR = 116;

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

function tronquer(ctx, texte, largeurMax) {
  if (ctx.measureText(texte).width <= largeurMax) return texte;
  let coupe = texte;
  while (coupe.length > 1 && ctx.measureText(`${coupe}…`).width > largeurMax) coupe = coupe.slice(0, -1);
  return `${coupe.trimEnd()}…`;
}

function texteEspace(ctx, texte, x, y, espacement) {
  let curseur = x;
  for (const lettre of texte) {
    ctx.fillText(lettre, curseur, y);
    curseur += ctx.measureText(lettre).width + espacement;
  }
}

// Les avatars sont immuables pour une URL donnée (Discord change l'URL quand
// l'avatar change) : on garde les derniers téléchargés pour ne pas refaire un
// aller-retour réseau à chaque sanction. Borné, le VPS n'a que 458 Mo.
const CACHE_AVATARS = new Map();
const CACHE_AVATARS_MAX = 30;

/**
 * Télécharge l'avatar. Renvoie `null` si ça échoue — une carte sans photo
 * reste parfaitement lisible, alors qu'une sanction qui plante parce que le
 * CDN Discord n'a pas répondu serait inacceptable. C'est la raison d'être du
 * try/catch : l'action a DÉJÀ été exécutée quand on dessine la carte.
 */
async function chargerAvatar(url) {
  if (!url) return null;
  if (CACHE_AVATARS.has(url)) return CACHE_AVATARS.get(url);
  try {
    const reponse = await fetch(url);
    if (!reponse.ok) return null;
    const image = await loadImage(Buffer.from(await reponse.arrayBuffer()));
    CACHE_AVATARS.set(url, image);
    if (CACHE_AVATARS.size > CACHE_AVATARS_MAX) CACHE_AVATARS.delete(CACHE_AVATARS.keys().next().value);
    return image;
  } catch (err) {
    console.error("[actionCard] avatar indisponible :", err.message);
    return null;
  }
}

/**
 * URL d'avatar d'un membre OU d'un utilisateur, sans supposer la forme de
 * l'objet : selon l'appelant on reçoit un GuildMember, un User, ou un objet
 * partiel (fiche reconstruite depuis l'historique, par exemple). Renvoie
 * `undefined` si rien n'est disponible — la carte tombe alors sur les
 * initiales.
 */
function avatarDe(membre) {
  if (!membre) return undefined;
  const source = typeof membre.displayAvatarURL === "function" ? membre : membre.user;
  if (typeof source?.displayAvatarURL !== "function") return undefined;
  try {
    return source.displayAvatarURL({ extension: "png", size: 128 });
  } catch {
    return undefined;
  }
}

/** Nom lisible d'un membre ou utilisateur, quelle que soit la forme reçue. */
function nomDe(membre) {
  return membre?.user?.tag || membre?.tag || membre?.user?.username || membre?.username || String(membre?.id || "inconnu");
}

/** Initiales, quand l'avatar n'a pas pu être chargé. */
function initiales(nom) {
  return (nom || "?")
    .split(/[\s#_.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => mot[0].toUpperCase())
    .join("");
}

/**
 * Dessine une carte d'action.
 * @param {object} spec
 * @param {string} spec.titre ex. "Rôle ajouté", "Membre banni"
 * @param {string} spec.couleur teinte de l'action (#rrggbb)
 * @param {{nom: string, sousTitre?: string, avatarURL?: string}} spec.membre
 * @param {{label: string, valeur: string, couleur?: string}[]} spec.lignes
 * @param {string} [spec.pied]
 * @returns {Promise<Buffer>} PNG
 */
async function rendreCarteAction(spec) {
  const lignes = (spec.lignes || []).filter((l) => l && l.valeur);
  const hauteur = Math.max(MARGE * 2 + AVATAR + 24, 132 + lignes.length * 34 + (spec.pied ? 30 : 0));

  const canvas = createCanvas(LARGEUR, hauteur);
  const ctx = canvas.getContext("2d");

  const degrade = ctx.createLinearGradient(0, 0, LARGEUR, hauteur);
  degrade.addColorStop(0, THEME.fondHaut);
  degrade.addColorStop(1, THEME.fond);
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, LARGEUR, hauteur);

  // Halo de la couleur d'action derrière l'avatar : c'est ce qui fait lire
  // l'issue de l'action (vert/rouge) avant même le texte.
  const halo = ctx.createRadialGradient(MARGE + AVATAR / 2, hauteur / 2, 10, MARGE + AVATAR / 2, hauteur / 2, 220);
  halo.addColorStop(0, avecAlpha(spec.couleur, "26"));
  halo.addColorStop(1, "#00000000");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, LARGEUR, hauteur);

  cheminArrondi(ctx, 10, 10, LARGEUR - 20, hauteur - 20, 16);
  ctx.strokeStyle = THEME.cadre;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Liseré vertical coloré, comme les cartes du tableau de bord.
  ctx.save();
  cheminArrondi(ctx, 10, 10, LARGEUR - 20, hauteur - 20, 16);
  ctx.clip();
  ctx.fillStyle = spec.couleur;
  ctx.fillRect(10, 10, 5, hauteur - 20);
  ctx.restore();

  // Avatar rond
  const ax = MARGE;
  const ay = (hauteur - AVATAR) / 2;
  const image = await chargerAvatar(spec.membre.avatarURL);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + AVATAR / 2, ay + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, ax, ay, AVATAR, AVATAR);
  } else {
    ctx.fillStyle = "#1b1529";
    ctx.fillRect(ax, ay, AVATAR, AVATAR);
    ctx.font = "40px ChakraBold";
    ctx.fillStyle = spec.couleur;
    ctx.textBaseline = "middle";
    const ini = initiales(spec.membre.nom);
    ctx.fillText(ini, ax + AVATAR / 2 - ctx.measureText(ini).width / 2, ay + AVATAR / 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(ax + AVATAR / 2, ay + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
  ctx.strokeStyle = spec.couleur;
  ctx.lineWidth = 3;
  ctx.stroke();

  const tx = ax + AVATAR + 30;
  const dispo = LARGEUR - tx - MARGE;
  ctx.textBaseline = "middle";

  ctx.font = "24px ChakraBold";
  ctx.fillStyle = spec.couleur;
  texteEspace(ctx, tronquer(ctx, spec.titre.toUpperCase(), dispo - 40), tx, 46, 1.8);

  ctx.font = "20px ChakraBold";
  ctx.fillStyle = THEME.texte;
  ctx.fillText(tronquer(ctx, spec.membre.nom, dispo), tx, 80);

  let y = 118;
  if (spec.membre.sousTitre) {
    ctx.font = "13px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    ctx.fillText(tronquer(ctx, spec.membre.sousTitre, dispo), tx, 102);
    y = 132;
  }

  for (const ligne of lignes) {
    ctx.font = "13px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    const labelLarge = 92;
    ctx.fillText(tronquer(ctx, ligne.label.toUpperCase(), labelLarge), tx, y);

    // Une ligne peut porter sa propre couleur (ex. la couleur réelle du rôle
    // attribué) : elle est alors précédée d'une pastille de cette teinte.
    let vx = tx + labelLarge + 12;
    if (ligne.couleur) {
      ctx.beginPath();
      ctx.arc(vx + 5, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = ligne.couleur;
      ctx.fill();
      vx += 18;
    }
    ctx.font = "15px ChakraBold";
    ctx.fillStyle = THEME.texte;
    ctx.fillText(tronquer(ctx, ligne.valeur, LARGEUR - vx - MARGE), vx, y);
    y += 34;
  }

  if (spec.pied) {
    ctx.font = "12px ChakraRegular";
    ctx.fillStyle = THEME.texteFaible;
    ctx.fillText(tronquer(ctx, spec.pied, dispo), tx, hauteur - MARGE + 4);
  }

  return canvas.toBuffer("image/png");
}

/**
 * Carte d'action prête à être postée. Renvoie `null` si le rendu échoue :
 * l'appelant retombe alors sur son message texte habituel plutôt que de ne
 * rien répondre du tout — l'action, elle, a déjà eu lieu.
 * @returns {Promise<{files: AttachmentBuilder[]}|null>}
 */
async function carteActionMessage(spec, nomFichier = "action.png") {
  try {
    const png = await rendreCarteAction(spec);
    return { files: [new AttachmentBuilder(png, { name: nomFichier })] };
  } catch (err) {
    console.error("[actionCard] rendu impossible :", err);
    return null;
  }
}


// Une entrée par action de modération : titre affiché et teinte. Regroupé ici
// pour que &kick et &ban ne puissent pas dériver l'un de l'autre, et que le
// vert/rouge veuille toujours dire la même chose.
const SANCTIONS = {
  kick: { titre: "Membre expulsé", couleur: "#fb923c" },
  ban: { titre: "Membre banni", couleur: "#ff6b6b" },
  tempban: { titre: "Bannissement temporaire", couleur: "#ff6b6b" },
  softban: { titre: "Softban", couleur: "#f472b6" },
  timeout: { titre: "Mise en timeout", couleur: "#fbbf24" },
  untimeout: { titre: "Timeout levé", couleur: "#4ade80" },
  mute: { titre: "Membre mute", couleur: "#fbbf24" },
  tempmute: { titre: "Mute temporaire", couleur: "#fbbf24" },
  unmute: { titre: "Démute", couleur: "#4ade80" },
  warn: { titre: "Avertissement", couleur: "#facc15" },
};

/**
 * Carte d'une sanction. `null` si l'action n'est pas connue ou si le rendu
 * échoue : l'appelant retombe alors sur son message texte.
 * @param {object} p
 * @param {keyof SANCTIONS} p.action
 * @param {import('discord.js').GuildMember} p.cible
 * @param {import('discord.js').User} p.moderateur
 * @param {string} [p.raison]
 * @param {string} [p.duree] déjà formatée par l'appelant
 * @param {string} [p.serveur]
 */
async function carteSanctionMessage({ action, cible, moderateur, raison, duree, serveur }) {
  const meta = SANCTIONS[action];
  if (!meta) return null;
  return carteActionMessage(
    {
      titre: meta.titre,
      couleur: meta.couleur,
      membre: { nom: nomDe(cible), sousTitre: cible.id, avatarURL: avatarDe(cible) },
      lignes: [
        { label: "Raison", valeur: raison },
        { label: "Durée", valeur: duree },
        { label: "Par", valeur: moderateur?.tag },
      ],
      pied: serveur,
    },
    `${action}.png`
  );
}

module.exports = { rendreCarteAction, carteActionMessage, carteSanctionMessage, avatarDe, nomDe, SANCTIONS, LARGEUR };
