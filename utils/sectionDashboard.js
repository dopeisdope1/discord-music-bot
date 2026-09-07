const { DateTime } = require("luxon");

// Transforme le corps TEXTE d'une rubrique du panel (utils/configPanel.js ::
// sectionBody) en spec de tableau de bord dessinable (utils/dashboardImage.js).
//
// Pourquoi partir du texte existant plutôt que d'écrire 27 specs à la main :
// sectionBody est déjà la source de vérité de chaque rubrique, déjà testée, et
// c'est elle que lisent les commandes texte équivalentes. Une seconde
// description des mêmes réglages divergerait au premier changement — c'est
// exactement le piège que le reste du bot évite partout (un seul catalogue,
// un seul moteur de permissions). Ici : un seul corps de rubrique, deux
// rendus.
//
// LE VRAI PIÈGE, et la raison d'être de ce module : Discord résout `<@123>`,
// `<#123>` et `<t:...>` à l'affichage, un canvas NON. Dessiner le corps brut
// afficherait « <@1210211587143766088> » au lieu d'un pseudo — soit une image
// MOINS lisible que le texte qu'elle remplace. Tout ce qui suit sert à
// résoudre ces formes avant de dessiner.

// Emojis de statut -> pastille colorée. La police embarquée n'a aucun glyphe
// emoji : dessiné tel quel, 🔴 sortirait en carré vide (le même problème que
// la légende des paliers de &help, déjà résolu par des pastilles dessinées).
const PASTILLES = {
  "🟢": "#4ade80", "✅": "#4ade80", "🟩": "#4ade80",
  "🔴": "#ff6b6b", "❌": "#ff6b6b", "🟥": "#ff6b6b",
  "🟠": "#fb923c", "⚠️": "#fb923c", "⚠": "#fb923c", "🟧": "#fb923c",
  "🟡": "#fbbf24", "🟨": "#fbbf24",
  "🔵": "#38bdf8", "💬": "#38bdf8", "🔷": "#38bdf8",
  "⚪": "#8b849f", "▫️": "#8b849f", "•": "#8b849f",
};

/**
 * Résout tout ce que Discord afficherait autrement que le texte brut.
 * Les identifiants inconnus du cache retombent sur une forme lisible
 * (« @membre inconnu ») plutôt que sur l'identifiant nu : une carte ne doit
 * jamais afficher un nombre de 18 chiffres à la place d'un nom.
 */
function resoudre(texte, guild) {
  if (!texte) return "";
  return String(texte)
    // Emojis custom du serveur : <:Nom:id> / <a:Nom:id>. Ils ne se dessinent
    // pas ; leur nom seul ferait du bruit ("Lock Anti-nuke"), on les retire.
    .replace(/<a?:[A-Za-z0-9_]+:\d+>/g, "")
    // Horodatages <t:secondes:format> -> date lisible. Sans ça, la rubrique
    // Historique afficherait « <t:1757260800:R> » sur chaque ligne.
    .replace(/<t:(\d+)(?::[tTdDfFR])?>/g, (_, sec) =>
      DateTime.fromSeconds(Number(sec)).setLocale("fr").toFormat("dd LLL yyyy 'à' HH'h'mm")
    )
    // Identifiant volontairement permissif (`[^>\s]+`, pas `\d+`) : un ID que
    // le motif rejette ressortirait TEL QUEL sur l'image — « <#123> » dessiné
    // en toutes lettres, exactement ce que ce module existe pour éviter.
    .replace(/<@&([^>\s]+)>/g, (_, id) => `@${guild?.roles?.cache?.get(id)?.name || "rôle inconnu"}`)
    .replace(/<#([^>\s]+)>/g, (_, id) => `#${guild?.channels?.cache?.get(id)?.name || "salon inconnu"}`)
    .replace(/<@!?([^>\s]+)>/g, (_, id) => {
      const m = guild?.members?.cache?.get(id);
      return `@${m?.displayName || m?.user?.username || "membre inconnu"}`;
    })
    // Marqueurs markdown : le canvas n'a ni gras ni italique par balise, la
    // hiérarchie passe par la taille et la couleur des polices.
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Détache l'emoji de statut de tête et renvoie sa couleur de pastille. */
function detacherPastille(texte) {
  for (const [emoji, couleur] of Object.entries(PASTILLES)) {
    if (texte.startsWith(emoji)) return { texte: texte.slice(emoji.length).trim(), couleur };
  }
  return { texte, couleur: null };
}

/**
 * Découpe le corps d'une rubrique en blocs typés.
 * @returns {{type: "sousTitre"|"reglage"|"ligne"|"note", label?: string, valeur?: string, texte?: string, couleur?: string}[]}
 */
function decouper(corps, guild) {
  const blocs = [];
  for (const brute of String(corps || "").split("\n")) {
    const ligne = brute.trim();
    // Une ligne vide sépare deux blocs dans le texte d'origine (les réglages,
    // puis la liste des détecteurs). Sans ce marqueur, tout se retrouverait
    // dans une seule carte fourre-tout.
    if (!ligne) {
      if (blocs.length && blocs.at(-1).type !== "separation") blocs.push({ type: "separation" });
      continue;
    }

    const citee = /^>\s?/.test(ligne);
    let reste = ligne.replace(/^>\s?/, "");

    // Titre markdown ("### Titre").
    if (/^#{2,3}\s/.test(reste)) {
      const { texte, couleur } = detacherPastille(reste.replace(/^#{2,3}\s*/, ""));
      const resolu = resoudre(texte, guild);
      if (resolu) blocs.push({ type: "sousTitre", texte: resolu, couleur });
      continue;
    }

    // En-tête de bloc entièrement en gras. L'emoji de gravité vit tantôt
    // DEVANT le gras ("🟠 **Avertissements**"), tantôt DEDANS
    // ("**🟠 Avertissements :**") — on le détache dans les deux cas, sinon la
    // couleur de la section est perdue et l'emoji finit dessiné en carré vide.
    const entete = /^\*\*(.+?)\*\*\s*:?$/.exec(reste);
    if (entete) {
      const { texte, couleur } = detacherPastille(entete[1].replace(/\s*:\s*$/, "").trim());
      const resolu = resoudre(texte, guild);
      if (resolu) blocs.push({ type: "sousTitre", texte: resolu, couleur });
      continue;
    }

    const { texte: sansEmoji, couleur } = detacherPastille(reste);

    // Réglage : "**Label** : valeur", la forme très majoritaire du panel.
    const reglage = /^\*\*(.+?)\*\*\s*(?:\((.+?)\))?\s*:\s*(.*)$/.exec(sansEmoji);
    if (reglage) {
      const [, label, precision, valeur] = reglage;
      const libelle = resoudre(precision ? `${label} (${precision})` : label, guild);
      const valeurResolue = resoudre(valeur, guild);
      // "**Messages** (…) :" sans rien après les deux-points n'est pas un
      // réglage mais l'en-tête du bloc qui suit.
      if (!valeurResolue) {
        blocs.push({ type: "sousTitre", texte: libelle, couleur });
        continue;
      }
      blocs.push({ type: "reglage", label: libelle, valeur: valeurResolue, couleur });
      continue;
    }

    const texte = resoudre(sansEmoji, guild);
    if (!texte) continue;
    // Une ligne citée, ou porteuse d'une pastille de statut, est une entrée de
    // liste (détecteurs anti-nuke, alertes de sécurité, dernières sanctions).
    // Le reste est de la prose, qui ira en pied de tableau.
    blocs.push(citee || couleur ? { type: "ligne", texte, couleur } : { type: "note", texte });
  }
  return blocs;
}

// Une ligne de liste plus longue que ça se fait tronquer par le moteur de
// rendu (« … »). Plutôt que de perdre la fin, on la replie sur la seconde
// ligne de l'entrée — celle qui porte déjà la valeur d'un réglage — coupée à
// un ESPACE, jamais au milieu d'un mot.
const LONGUEUR_LIGNE = 52;
function surDeuxLignes(texte) {
  if (texte.length <= LONGUEUR_LIGNE) return { nom: texte };
  const coupe = texte.lastIndexOf(" ", LONGUEUR_LIGNE);
  const pivot = coupe > LONGUEUR_LIGNE / 2 ? coupe : LONGUEUR_LIGNE;
  return { nom: texte.slice(0, pivot).trim(), description: texte.slice(pivot).trim() };
}

// Au-delà, la carte devient un mur illisible une fois réduite par Discord :
// le reste part dans une carte "(suite)" que la grille pose à côté.
const LIGNES_PAR_CARTE = 9;

/**
 * Corps d'une rubrique -> spec pour utils/dashboardImage.js::rendre.
 * @param {string} corps sortie de sectionBody()
 * @param {object} o
 * @param {string} o.titre nom de la rubrique (jamais deviné : celui du panel)
 * @param {string} o.couleur teinte de la famille
 * @param {string} o.sousTitre ligne d'identité
 * @param {import('discord.js').Guild} [o.guild] pour résoudre les mentions
 */
function enSpec(corps, { titre, couleur, sousTitre, guild, colonnes }) {
  const blocs = decouper(corps, guild);
  const cartes = [];
  const notes = [];
  let courante = null;
  // Titre de base : sans lui, une carte déjà nommée « X (suite) » qui déborde
  // à son tour donnerait « X (suite) (suite) ».
  let base = titre;
  let couper = false;

  // Un en-tête coloré (« 🟠 Avertissements ») teinte toute sa carte : c'est ce
  // qui rend la gravité lisible d'un coup d'œil, là où le texte ne pouvait que
  // répéter un emoji par ligne.
  const nouvelleCarte = (titreCarte, teinte) => {
    courante = { titre: titreCarte, couleur: teinte || couleur, items: [] };
    cartes.push(courante);
    return courante;
  };
  // Numérotées : deux cartes « X (suite) » côte à côte ne se distingueraient
  // pas l'une de l'autre.
  let suites = 0;
  /** Prolonge la carte courante sous le même titre, sans empiler les « (suite) ». */
  const prolonger = () => nouvelleCarte(`${base} (suite${++suites > 1 ? ` ${suites}` : ""})`, courante?.couleur);

  for (const bloc of blocs) {
    if (bloc.type === "note") {
      notes.push(bloc.texte);
      continue;
    }
    if (bloc.type === "separation") {
      couper = Boolean(courante?.items.length);
      continue;
    }
    if (bloc.type === "sousTitre") {
      base = bloc.texte;
      suites = 0;
      couper = false;
      nouvelleCarte(bloc.texte, bloc.couleur);
      continue;
    }
    if (!courante) nouvelleCarte(base);
    // Une carte pleine, ou un bloc explicitement séparé dans le texte
    // d'origine, se prolonge au lieu de s'allonger indéfiniment.
    if (couper || courante.items.length >= LIGNES_PAR_CARTE) prolonger();
    couper = false;

    courante.items.push(
      bloc.type === "reglage"
        ? { nom: bloc.label, description: bloc.valeur, couleurPastille: bloc.couleur || undefined }
        : { ...surDeuxLignes(bloc.texte), couleurPastille: bloc.couleur || undefined }
    );
  }

  if (!cartes.length) {
    cartes.push({ titre, couleur, items: [], vide: notes.shift() || "Rien à afficher pour l'instant." });
  }

  // Deux colonnes coupent les lignes longues en plein milieu (« Anti-nuke
  // désactivé — antinuke on p… ») : c'est le défaut que la refonte de
  // lisibilité avait déjà corrigé sur &help. On ne passe donc à deux colonnes
  // que si TOUT tient dans une demi-largeur.
  const plusLongue = Math.max(0, ...cartes.flatMap((c) => c.items.map((i) => `${i.nom} ${i.description || ""}`.trim().length)));
  return {
    titre,
    sousTitre,
    colonnes: colonnes || (plusLongue <= 42 ? 2 : 1),
    cartes,
    // La prose (ce que fait l'écran, les avertissements) passe en pied plutôt
    // qu'en carte : ce sont des phrases, pas des réglages.
    pied: notes.length ? notes.join(" · ") : undefined,
    hauteursLibres: true,
  };
}

module.exports = { enSpec, decouper, resoudre, PASTILLES };
