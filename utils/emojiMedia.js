const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

// Préparation d'un média avant d'en faire un émoji.
//
// LE PROBLÈME : la plupart des « GIF » du web n'en sont plus. Tenor, Klipy et
// consorts servent du MP4 — c'est plus léger — et Discord REFUSE le MP4 pour
// un émoji : il n'accepte que PNG, JPEG et GIF, sous 256 Ko. Coller un lien
// attrapé sur un site de GIF échouait donc systématiquement, avec pour seule
// explication le message brut de l'API.
//
// Ce module télécharge, convertit si besoin, et rétrécit jusqu'à passer sous
// la limite.

// Discord plafonne un émoji à 256 Ko. On vise en dessous : la taille annoncée
// par l'API et celle du fichier ne coïncident pas toujours à l'octet près.
const MAX_EMOJI = 256 * 1024;
const MARGE_EMOJI = 248 * 1024;

// Au-delà, on ne télécharge même pas : la conversion doit rester bornée sur un
// VPS de 458 Mo. 16 Mo laisse passer les GIF réellement rencontrés — un GIF de
// quinze secondes en 640 px pèse déjà 8 Mo — sans ouvrir la porte à une vidéo
// entière.
const MAX_TELECHARGEMENT = 16 * 1024 * 1024;

const TIMEOUT_TELECHARGEMENT_MS = 15_000;
const TIMEOUT_CONVERSION_MS = 25_000;

/** Le binaire ffmpeg embarqué, ou `null` s'il n'est pas installé. */
function binaireFfmpeg() {
  try {
    const chemin = require("ffmpeg-static");
    return chemin && fs.existsSync(chemin) ? chemin : null;
  } catch {
    return null;
  }
}

/**
 * Un lien de pièce jointe Discord, donc soumis à expiration ?
 *
 * On ne cherche PAS à deviner si la signature est encore valable : elle peut
 * être présente et périmée. La question posée est seulement « ce 404
 * s'explique-t-il par l'expiration ? », et pour un lien d'attachement Discord
 * la réponse est oui dans l'immense majorité des cas.
 */
function lienDiscordExpire(url) {
  return /^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//i.test(String(url));
}

/** Une vidéo, qu'il faudra convertir ? */
function estVideo(url, contentType = "") {
  return /^video\//i.test(contentType) || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(String(url));
}

/**
 * Télécharge un média.
 * @returns {Promise<{ok: true, buffer: Buffer, type: string}|{ok: false, motif: string}>}
 */
async function telecharger(url) {
  let reponse;
  try {
    // Timeout OBLIGATOIRE : sans lui, un hébergeur qui ne répond pas laisse la
    // commande sans réponse pour toujours — même piège que les avatars des
    // cartes de sanction (utils/actionCard.js).
    reponse = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_TELECHARGEMENT_MS) });
  } catch (err) {
    return { ok: false, motif: `Le lien n'a pas répondu (${err.message}).` };
  }
  if (!reponse.ok) {
    // Cas de loin le plus fréquent, et le plus déroutant : depuis 2023, les
    // liens de pièces jointes Discord sont SIGNÉS et expirent au bout de
    // quelques heures. Un lien recopié sans ses paramètres `?ex=…&is=…&hm=…`,
    // ou simplement trop vieux, renvoie 404 à tout le monde — y compris à
    // Discord lui-même. « erreur 404 » n'aidait personne à comprendre ça.
    if (lienDiscordExpire(url)) {
      return {
        ok: false,
        motif: [
          "Ce lien Discord a expiré — ils ne sont valables que quelques heures.",
          "Joins directement le fichier à ton message : `create <nom>` avec l'image en pièce jointe.",
        ].join("\n"),
      };
    }
    return { ok: false, motif: `Le lien renvoie une erreur ${reponse.status}.` };
  }

  const annoncee = Number(reponse.headers.get("content-length") || 0);
  if (annoncee > MAX_TELECHARGEMENT) {
    return { ok: false, motif: `Fichier trop lourd (${Math.round(annoncee / 1048576)} Mo) — 8 Mo maximum.` };
  }
  const buffer = Buffer.from(await reponse.arrayBuffer());
  // Revérifié après coup : `content-length` est déclaratif et peut manquer.
  if (buffer.length > MAX_TELECHARGEMENT) {
    return { ok: false, motif: `Fichier trop lourd (${Math.round(buffer.length / 1048576)} Mo) — 8 Mo maximum.` };
  }
  return { ok: true, buffer, type: reponse.headers.get("content-type") || "" };
}

/** Lance ffmpeg sur des fichiers temporaires, en bornant sa durée. */
function lancerFfmpeg(binaire, args) {
  return new Promise((resolve) => {
    execFile(binaire, args, { timeout: TIMEOUT_CONVERSION_MS, maxBuffer: 1024 * 1024 }, (err) => resolve(!err));
  });
}

// Réglages essayés dans l'ordre, du plus beau au plus économe. Un émoji
// s'affiche autour de 32 à 48 px : descendre la définition ne se voit
// pratiquement pas, alors que ça divise le poids.
//
// La DURÉE baisse elle aussi le long de l'échelle, et c'est ce qui manquait :
// sur un GIF long, aucune définition ne suffit tant qu'on garde six secondes
// de rushes. Un émoji est une vignette d'une ou deux secondes, pas un extrait.
const RENDUS = [
  { fps: 20, largeur: 128, couleurs: 128, secondes: 6 },
  { fps: 15, largeur: 112, couleurs: 64, secondes: 6 },
  { fps: 12, largeur: 96, couleurs: 64, secondes: 5 },
  { fps: 10, largeur: 80, couleurs: 48, secondes: 4 },
  { fps: 10, largeur: 64, couleurs: 32, secondes: 3 },
  { fps: 8, largeur: 56, couleurs: 24, secondes: 2.5 },
  { fps: 6, largeur: 48, couleurs: 16, secondes: 2 },
];

// Définitions essayées pour une image FIXE trop lourde. Réencoder en PNG
// réduit bien plus qu'un passage par le GIF, qui n'aurait ici qu'une image.
const TAILLES_FIXES = [128, 96, 64, 48];

/**
 * Convertit une vidéo en GIF assez léger pour un émoji.
 *
 * La palette est calculée sur la vidéo elle-même (`palettegen`/`paletteuse`)
 * plutôt que laissée au tirage par défaut : sans ça, un GIF de 256 couleurs
 * prises au hasard rend des aplats sales, pour un fichier plus lourd.
 *
 * @returns {Promise<{ok: true, buffer: Buffer}|{ok: false, motif: string}>}
 */
async function versGif(buffer) {
  const binaire = binaireFfmpeg();
  if (!binaire) {
    return { ok: false, motif: "La conversion vidéo n'est pas disponible sur ce bot (ffmpeg absent)." };
  }

  const base = path.join(os.tmpdir(), `emoji-${crypto.randomBytes(6).toString("hex")}`);
  const entree = `${base}.src`;
  const sortie = `${base}.gif`;
  const aNettoyer = [entree, sortie];

  try {
    await fs.promises.writeFile(entree, buffer);
    let meilleur = null;
    for (const rendu of RENDUS) {
      const filtre =
        `fps=${rendu.fps},scale=${rendu.largeur}:-1:flags=lanczos,split[s0][s1];` +
        `[s0]palettegen=max_colors=${rendu.couleurs}[p];[s1][p]paletteuse=dither=bayer`;
      const ok = await lancerFfmpeg(binaire, [
        "-y", "-i", entree, "-t", String(rendu.secondes), "-vf", filtre, "-loop", "0", sortie,
      ]);
      if (!ok) continue;
      const gif = await fs.promises.readFile(sortie).catch(() => null);
      if (!gif) continue;
      if (gif.length <= MARGE_EMOJI) return { ok: true, buffer: gif, anime: true };
      if (!meilleur || gif.length < meilleur.length) meilleur = gif;
    }

    // DERNIER RECOURS : garder la première image, en fixe. Une source très
    // longue ou très détaillée ne rentre parfois sous 256 Ko à AUCUN réglage
    // animé — mais un émoji fixe reste un émoji, là où un refus ne laisse
    // rien. L'appelant en informe la personne, pour que la perte soit dite et
    // non subie.
    const fixe = await versImageFixe(buffer, binaire);
    if (fixe.ok) return { ok: true, buffer: fixe.buffer, anime: false };

    const taille = meilleur ? ` (au mieux ${Math.round(meilleur.length / 1024)} Ko)` : "";
    return { ok: false, motif: `Impossible de descendre sous les 256 Ko de Discord${taille}.` };
  } catch (err) {
    return { ok: false, motif: `Conversion impossible : ${err.message}` };
  } finally {
    for (const fichier of aNettoyer) await fs.promises.unlink(fichier).catch(() => {});
  }
}

/**
 * Réduit une image FIXE jusqu'à passer sous la limite.
 *
 * Sert à deux choses : alléger un PNG/JPEG trop lourd, et servir de dernier
 * recours quand aucun réglage animé ne rentre.
 *
 * @returns {Promise<{ok: true, buffer: Buffer}|{ok: false, motif: string}>}
 */
async function versImageFixe(buffer, binaireDonne) {
  const binaire = binaireDonne || binaireFfmpeg();
  if (!binaire) return { ok: false, motif: "La réduction d'image n'est pas disponible sur ce bot (ffmpeg absent)." };

  const base = path.join(os.tmpdir(), `emoji-fixe-${crypto.randomBytes(6).toString("hex")}`);
  const entree = `${base}.src`;
  const sortie = `${base}.png`;
  try {
    await fs.promises.writeFile(entree, buffer);
    for (const largeur of TAILLES_FIXES) {
      const ok = await lancerFfmpeg(binaire, [
        "-y", "-i", entree, "-frames:v", "1", "-vf", `scale=${largeur}:-1:flags=lanczos`, sortie,
      ]);
      if (!ok) continue;
      const png = await fs.promises.readFile(sortie).catch(() => null);
      if (png && png.length <= MARGE_EMOJI) return { ok: true, buffer: png };
    }
    return { ok: false, motif: "Impossible de réduire cette image sous les 256 Ko de Discord." };
  } catch (err) {
    return { ok: false, motif: `Réduction impossible : ${err.message}` };
  } finally {
    for (const fichier of [entree, sortie]) await fs.promises.unlink(fichier).catch(() => {});
  }
}

/**
 * Prépare ce qu'il faut passer à `guild.emojis.create`.
 *
 * @returns {Promise<{ok: true, attachment: string|Buffer, converti: boolean}|{ok: false, motif: string}>}
 *   `attachment` reste l'URL telle quelle quand rien n'a besoin d'être fait —
 *   Discord la télécharge alors lui-même, ce qui évite un aller-retour.
 */
async function preparerEmoji(url) {
  const telechargement = await telecharger(url);
  if (!telechargement.ok) return telechargement;

  const { buffer, type } = telechargement;
  const anime = estVideo(url, type) || /gif/i.test(type) || /\.gif(\?|$)/i.test(String(url));

  if (anime) {
    // Une vidéo doit être convertie quoi qu'il arrive ; un GIF déjà sous la
    // limite passe tel quel, sans réencodage inutile.
    if (!estVideo(url, type) && buffer.length <= MARGE_EMOJI) {
      return { ok: true, attachment: buffer, converti: false };
    }
    const gif = await versGif(buffer);
    if (!gif.ok) return gif;
    return {
      ok: true,
      attachment: gif.buffer,
      converti: true,
      // Dit, et non subi : l'appelant prévient que l'animation a été perdue.
      note: gif.anime ? null : "trop lourd pour rester animé — gardé en image fixe",
    };
  }

  if (buffer.length > MARGE_EMOJI) {
    const reduite = await versImageFixe(buffer);
    if (!reduite.ok) {
      return {
        ok: false,
        motif: `Image trop lourde (${Math.round(buffer.length / 1024)} Ko) et impossible à réduire sous les 256 Ko de Discord.`,
      };
    }
    return { ok: true, attachment: reduite.buffer, converti: true, note: "redimensionné pour tenir sous 256 Ko" };
  }
  return { ok: true, attachment: buffer, converti: false };
}

module.exports = {
  preparerEmoji,
  telecharger,
  versGif,
  versImageFixe,
  estVideo,
  lienDiscordExpire,
  binaireFfmpeg,
  MAX_EMOJI,
  MAX_TELECHARGEMENT,
};
