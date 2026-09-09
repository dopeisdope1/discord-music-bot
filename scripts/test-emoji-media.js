/**
 * &create : préparation d'un média avant d'en faire un émoji
 * (utils/emojiMedia.js).
 *
 * LE PROBLÈME QUE CE MODULE RÉSOUT : la plupart des « GIF » du web n'en sont
 * plus. Tenor, Klipy et consorts servent du MP4, et Discord REFUSE le MP4 pour
 * un émoji — il n'accepte que PNG, JPEG et GIF, sous 256 Ko. Coller un lien
 * pris sur un site de GIF échouait donc systématiquement.
 *
 * Les cas qui font tourner ffmpeg sont marqués : ils sont IGNORÉS si le
 * binaire n'est pas là, plutôt que de faire échouer toute la suite sur une
 * machine où il n'est pas installé.
 *
 * Lancement : node scripts/test-emoji-media.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "emojimedia-test-"));

const media = require("../utils/emojiMedia");

let reussis = 0;
let ignores = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
    process.exitCode = 1;
  }
}
async function casFfmpeg(nom, fn) {
  if (!media.binaireFfmpeg()) {
    ignores++;
    console.log(`  ignoré (ffmpeg absent) — ${nom}`);
    return;
  }
  return cas(nom, fn);
}

/** Une vraie petite vidéo, fabriquée par ffmpeg lui-même. */
function videoDeTest(secondes = 2) {
  const binaire = media.binaireFfmpeg();
  const chemin = path.join(process.env.DATA_DIR, `test-${secondes}.mp4`);
  execFileSync(binaire, [
    "-y", "-f", "lavfi",
    "-i", `testsrc=size=320x240:rate=15:duration=${secondes}`,
    "-pix_fmt", "yuv420p", chemin,
  ], { stdio: "ignore" });
  return fs.readFileSync(chemin);
}

(async () => {
  console.log("Reconnaître ce qui doit être converti :");

  await cas("un MP4 est reconnu comme vidéo, par son type comme par son extension", () => {
    assert.strictEqual(media.estVideo("https://x/y.mp4", ""), true);
    assert.strictEqual(media.estVideo("https://x/y", "video/mp4"), true);
    // Le lien du proxy Discord garde l'extension d'origine à la fin.
    assert.strictEqual(media.estVideo("https://images-ext-1.discordapp.net/external/abc/https/s.klipy.com/a.mp4", ""), true);
    assert.strictEqual(media.estVideo("https://x/y.webm", ""), true);
  });

  await cas("une image n'est PAS prise pour une vidéo", () => {
    for (const url of ["https://x/y.gif", "https://x/y.png", "https://x/y.jpg"]) {
      assert.strictEqual(media.estVideo(url, "image/gif"), false, url);
    }
  });

  console.log("\nConversion vidéo -> GIF :");

  await casFfmpeg("une vidéo devient un VRAI GIF, sous la limite de Discord", async () => {
    const resultat = await media.versGif(videoDeTest(2));
    assert.ok(resultat.ok, resultat.motif);
    // L'en-tête du fichier, pas son extension : c'est ce que Discord regarde.
    assert.strictEqual(resultat.buffer.subarray(0, 3).toString(), "GIF");
    assert.ok(resultat.buffer.length <= media.MAX_EMOJI, `${resultat.buffer.length} octets — au-dessus des 256 Ko`);
  });

  await casFfmpeg("une vidéo LONGUE est tronquée et tient quand même sous la limite", async () => {
    // C'est le cas qui échouait sans repli : un clip de plusieurs secondes en
    // pleine définition dépasse largement 256 Ko une fois converti.
    const resultat = await media.versGif(videoDeTest(12));
    assert.ok(resultat.ok, resultat.motif);
    assert.ok(resultat.buffer.length <= media.MAX_EMOJI, `${resultat.buffer.length} octets`);
  });

  await cas("un fichier illisible échoue proprement, sans planter", async () => {
    const resultat = await media.versGif(Buffer.from("ceci n'est pas une video"));
    assert.strictEqual(resultat.ok, false);
    assert.ok(resultat.motif, "un motif doit être donné à l'utilisateur");
  });

  console.log("\nGarde-fous de téléchargement :");

  await cas("un lien qui ne répond pas donne un motif, pas une attente sans fin", async () => {
    // Sans timeout, la commande resterait sans réponse pour toujours — même
    // piège que les avatars des cartes de sanction.
    const resultat = await media.telecharger("https://127.0.0.1:9/rien.gif");
    assert.strictEqual(resultat.ok, false);
    assert.ok(resultat.motif.length, "le motif doit être renseigné");
  });

  await cas("les bornes annoncées sont celles de Discord", () => {
    assert.strictEqual(media.MAX_EMOJI, 256 * 1024, "Discord plafonne un émoji à 256 Ko");
    assert.ok(media.MAX_TELECHARGEMENT <= 8 * 1024 * 1024, "on ne télécharge pas une vidéo entière sur un VPS de 458 Mo");
  });

  console.log(`\n${reussis} cas vérifiés${ignores ? `, ${ignores} ignoré(s)` : ""}${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
