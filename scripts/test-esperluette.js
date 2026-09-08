/**
 * Vérifie que l'ESPERLUETTE dessinée ressemble à celle qu'on tape.
 *
 * Chakra Petch, la police embarquée, dessine « & » comme un « 8 » barré. Le
 * préfixe du bot ÉTANT « & », tout ce que les images annonçaient se lisait
 * « 8kick », « 8ban », « Préfixe : 8 » — la seule chose qu'une image d'aide
 * doit garantir, c'est qu'on puisse recopier ce qu'elle montre.
 *
 * Ce fichier protège deux choses :
 *   1. le caractère est bien emprunté à la police de secours ;
 *   2. TOUT appel de dessin passe par ce chemin. Un seul `ctx.fillText` oublié
 *      dans un coin et le « 8 » réapparaît à cet endroit-là, sans que rien ne
 *      le signale — c'est exactement ainsi que le défaut est passé inaperçu.
 *
 * Lancement : node scripts/test-esperluette.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("@napi-rs/canvas");
const { ecrire, largeur } = require("../utils/dashboardImage");

let reussis = 0;
function cas(nom, fn) {
  try {
    fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
    process.exitCode = 1;
  }
}

/** Dessine un texte et renvoie les pixels allumés, pour comparer deux rendus. */
function empreinte(texte, police) {
  const canvas = createCanvas(300, 60);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 300, 60);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.font = police;
  ecrire(ctx, texte, 10, 30);
  return canvas.toBuffer("image/png").toString("base64");
}

/** Le même texte dessiné SANS le détour — ce que donnait l'ancien code. */
function empreinteBrute(texte, police) {
  const canvas = createCanvas(300, 60);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 300, 60);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.font = police;
  ctx.fillText(texte, 10, 30);
  return canvas.toBuffer("image/png").toString("base64");
}

console.log("L'esperluette est empruntée à une police qui en dessine une vraie :");

cas("les polices de secours sont bien embarquées dans le dépôt", () => {
  // Un VPS Linux nu n'a quasiment aucune police : une police absente ferait
  // silencieusement retomber le rendu sur autre chose.
  for (const fichier of ["Rajdhani-Bold.ttf", "Rajdhani-Medium.ttf"]) {
    const chemin = path.join(__dirname, "..", "assets", "fonts", fichier);
    assert.ok(fs.existsSync(chemin), `${fichier} manque dans assets/fonts`);
  }
});

cas("un texte SANS esperluette est dessiné exactement comme avant", () => {
  // Le détour ne doit rien changer au reste : c'est ce qui autorise à
  // l'appliquer partout sans y regarder à deux fois.
  for (const police of ["20px ChakraBold", "16px ChakraRegular"]) {
    assert.strictEqual(empreinte("kick @membre", police), empreinteBrute("kick @membre", police), police);
  }
});

cas("un texte AVEC esperluette est dessiné différemment — le « 8 » a disparu", () => {
  for (const police of ["20px ChakraBold", "16px ChakraRegular"]) {
    assert.notStrictEqual(empreinte("&kick", police), empreinteBrute("&kick", police), `${police} : le glyphe n'a pas été remplacé`);
  }
});

cas("la largeur annoncée est celle réellement dessinée", () => {
  // Sinon la troncature couperait au mauvais endroit et les centrages
  // seraient décalés, d'autant que l'esperluette de secours n'a pas la même
  // chasse que celle d'origine.
  const canvas = createCanvas(10, 10);
  const ctx = canvas.getContext("2d");
  ctx.font = "20px ChakraBold";
  const mesuree = largeur(ctx, "&kick");
  const brute = ctx.measureText("&kick").width;
  assert.notStrictEqual(mesuree, brute, "la largeur doit tenir compte du glyphe emprunté");
  // Décomposée à la main : le morceau emprunté, plus le reste.
  ctx.font = "20px AmpBold";
  const esperluette = ctx.measureText("&").width;
  ctx.font = "20px ChakraBold";
  assert.strictEqual(mesuree, esperluette + ctx.measureText("kick").width);
});

cas("mesurer ne laisse PAS la police modifiée derrière elle", () => {
  // largeur() et ecrire() changent ctx.font en cours de route : mal remise,
  // toute la suite du dessin partirait dans la mauvaise police.
  const ctx = createCanvas(10, 10).getContext("2d");
  ctx.font = "20px ChakraBold";
  largeur(ctx, "&kick");
  assert.ok(ctx.font.includes("ChakraBold"), ctx.font);
  ecrire(ctx, "&kick", 0, 0);
  assert.ok(ctx.font.includes("ChakraBold"), ctx.font);
});

console.log("\nAucun appel de dessin ne contourne le détour :");

cas("les moteurs d'image n'appellent plus ctx.fillText/measureText directement", () => {
  // La garantie la plus importante du fichier : elle vaut pour le code écrit
  // plus tard, pas seulement pour celui d'aujourd'hui.
  //
  // Les seules lignes autorisées à appeler l'API brute sont celles du détour
  // lui-même, marquées `// détour-ok`. Une marque explicite plutôt qu'une
  // heuristique sur le nom de la fonction englobante : c'est vérifiable d'un
  // coup d'œil, et ça oblige à un geste conscient pour l'ajouter.
  for (const fichier of ["dashboardImage.js", "actionCard.js"]) {
    const lignes = fs.readFileSync(path.join(__dirname, "..", "utils", fichier), "utf8").split("\n");
    lignes.forEach((ligne, i) => {
      if (/^\s*(\*|\/\/)/.test(ligne)) return; // commentaires
      if (/détour-ok/.test(ligne)) return;
      assert.ok(!/\bctx\.fillText\(/.test(ligne), `${fichier}:${i + 1} appelle ctx.fillText — utiliser ecrire()`);
      assert.ok(!/\bctx\.measureText\(/.test(ligne), `${fichier}:${i + 1} appelle ctx.measureText — utiliser largeur()`);
    });
  }
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
