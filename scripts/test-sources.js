/**
 * Vérifie le diagnostic des sources audio (utils/sourcesDiagnostic.js).
 *
 * L'intérêt du diagnostic tient entièrement à un point : une source qui NOUS
 * REFUSE l'accès ne doit pas être confondue avec une recherche sans résultat.
 * C'est cette distinction que ces cas protègent.
 *
 * Lancement : node scripts/test-sources.js
 */
const assert = require("assert");
const { probeSources, summarize, buildProbes } = require("../utils/sourcesDiagnostic");

/** Faux nœud Lavalink : renvoie la réponse préparée pour chaque identifiant. */
function fakeKazagumo(reponses, { connecte = true } = {}) {
  const demandes = [];
  const noeud = {
    name: "prive",
    state: connecte ? 1 : 3,
    rest: {
      resolve: async (identifier) => {
        demandes.push(identifier);
        const reponse = reponses[identifier];
        if (reponse instanceof Error) throw reponse;
        return reponse ?? { loadType: "empty" };
      },
    },
  };
  return { kazagumo: { shoukaku: { nodes: new Map([["prive", noeud]]) } }, demandes };
}

const RESULTAT_SC = {
  loadType: "search",
  data: [{ info: { title: "One More Time" } }, { info: { title: "Autre" } }],
};
const REFUS_YT = {
  loadType: "error",
  data: { message: "Sign in to confirm you're not a bot", severity: "fault" },
};

let reussis = 0;
function cas(nom, fn) {
  return fn()
    .then(() => {
      reussis++;
      console.log(`  ok — ${nom}`);
    })
    .catch((err) => {
      console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
      process.exitCode = 1;
    });
}

async function main() {
  console.log("Diagnostic des sources :");

  await cas("un refus de YouTube est rapporté tel quel, pas en 'aucun résultat'", async () => {
    const { kazagumo } = fakeKazagumo({
      "scsearch:test": RESULTAT_SC,
      "ytsearch:test": REFUS_YT,
      "ytmsearch:test": REFUS_YT,
    });

    const { lignes } = await probeSources(kazagumo, "test");
    const yt = lignes.find((l) => l.startsWith("**YouTube**"));

    assert.match(yt, /ÉCHEC/, "un refus doit être signalé comme un échec");
    assert.match(yt, /Sign in to confirm/, "la raison exacte doit remonter");
    assert.match(
      lignes.find((l) => l.startsWith("**SoundCloud**")),
      /ok — 2 résultats, dont « One More Time »/
    );
  });

  await cas("une recherche vraiment vide reste distinguée d'un refus", async () => {
    const { kazagumo } = fakeKazagumo({ "scsearch:inconnu": { loadType: "empty" } });
    const { lignes } = await probeSources(kazagumo, "inconnu");

    assert.match(lignes[0], /aucun résultat/);
    assert.doesNotMatch(lignes[0], /ÉCHEC/);
  });

  await cas("un lien n'est testé que tel quel", async () => {
    const lien = "https://open.spotify.com/track/abc";
    const { kazagumo, demandes } = fakeKazagumo({ [lien]: { loadType: "track", data: { info: { title: "Balafres" } } } });

    const { lignes } = await probeSources(kazagumo, lien);

    assert.deepStrictEqual(demandes, [lien], "aucun préfixe de recherche ne doit être ajouté à un lien");
    assert.match(lignes[0], /ok — Balafres/);
  });

  await cas("un nœud injoignable est dit clairement", async () => {
    const kazagumo = { shoukaku: { nodes: new Map() } };
    const { lignes, noeud } = await probeSources(kazagumo, "test");

    assert.strictEqual(noeud, null);
    assert.match(lignes[0], /Aucun nœud audio/);
  });

  await cas("une exception réseau ne fait pas tomber le diagnostic", async () => {
    const { kazagumo } = fakeKazagumo({ "scsearch:test": new Error("connexion refusée") });
    const { lignes } = await probeSources(kazagumo, "test");

    assert.match(lignes[0], /ÉCHEC — connexion refusée/);
  });

  console.log("\nLecture des réponses de Lavalink :");

  await cas("chaque type de réponse est traduit", async () => {
    assert.match(summarize({ loadType: "track", data: { info: { title: "X" } } }), /ok — X/);
    assert.match(summarize({ loadType: "playlist", data: { info: { name: "P" }, tracks: [1, 2] } }), /2 titres/);
    assert.match(summarize({ loadType: "empty" }), /aucun résultat/);
    assert.match(summarize({ loadType: "error", data: { message: "boum" } }), /ÉCHEC — boum/);
    assert.match(summarize(null), /aucune réponse/);
  });

  await cas("une recherche teste bien les trois sources de son", async () => {
    const sondes = buildProbes("daft punk").map((p) => p.identifier);
    assert.deepStrictEqual(sondes, ["scsearch:daft punk", "ytsearch:daft punk", "ytmsearch:daft punk"]);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
}

main();
