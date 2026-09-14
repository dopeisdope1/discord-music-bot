/**
 * Compteurs de serveur : &compteur, et la mise à jour des noms de salon
 * (utils/counterStore.js, utils/counters.js).
 *
 * CE QUE CE FICHIER PROTÈGE AVANT TOUT : la cadence de renommage.
 *
 * Discord limite le renommage d'un salon à DEUX fois par tranche de 10
 * minutes, par salon. Au-delà, la requête n'échoue pas franchement — elle est
 * mise en attente très longtemps côté Discord puis appliquée. Un compteur qui
 * renomme à chaque arrivée se retrouve donc figé sur une valeur périmée SANS
 * la moindre erreur pour le signaler. C'est le défaut classique de cette
 * fonctionnalité, et il est invisible en test manuel : tout marche pendant
 * les deux premières minutes.
 *
 * Lancement : node scripts/test-compteurs.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "compteurs-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection } = require("discord.js");
const store = require("../utils/counterStore");
const counters = require("../utils/counters");

let reussis = 0;
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

const GUILD = "g1";

/** Un salon qui note chaque renommage réellement appliqué. */
function salon(id, nom = "ancien") {
  const applique = [];
  return {
    id,
    name: nom,
    applique,
    setName: async (n) => {
      applique.push(n);
      // Discord renvoie le salon modifié : on reflète le nouveau nom, sinon
      // le contrôle « déjà à jour » ne servirait à rien.
      const self = module.exports.__salons?.[id];
      if (self) self.name = n;
      return n;
    },
  };
}

function guilde({ membres = 10, bots = 2, boosts = 3, salons = [] } = {}) {
  const cache = new Collection();
  for (let i = 0; i < membres; i++) cache.set(`h${i}`, { user: { bot: false } });
  for (let i = 0; i < bots; i++) cache.set(`b${i}`, { user: { bot: true } });
  const salonCache = new Collection(salons.map((s) => [s.id, s]));
  return {
    id: GUILD,
    memberCount: membres + bots,
    premiumSubscriptionCount: boosts,
    members: { cache },
    channels: { cache: salonCache },
  };
}

(async () => {
  console.log("Ce qui est compté vient du serveur, pas d'une estimation :");

  await cas("chaque type renvoie la valeur réelle", () => {
    const g = guilde({ membres: 10, bots: 2, boosts: 3 });
    assert.strictEqual(store.valeur("membres", g), 12, "le total vient de memberCount");
    assert.strictEqual(store.valeur("humains", g), 10);
    assert.strictEqual(store.valeur("bots", g), 2);
    assert.strictEqual(store.valeur("boosts", g), 3);
    assert.strictEqual(store.valeur("inconnu", g), null);
  });

  await cas("le modèle place le nombre où on lui dit, avec un séparateur de milliers", () => {
    const g = guilde({ membres: 1200, bots: 34 });
    // Le séparateur n'est PAS écrit en dur : `toLocaleString("fr-FR")` produit
    // une espace insécable étroite (U+202F), qui a déjà changé entre versions
    // d'ICU. On compare donc au même formatage, et on vérifie séparément que
    // ce n'est pas simplement « 1234 » collé.
    assert.strictEqual(store.nomAttendu({ type: "membres", modele: "👥 {n} membres" }, g), `👥 ${(1234).toLocaleString("fr-FR")} membres`);
    assert.ok(!store.nomAttendu({ type: "membres", modele: "{n}" }, g).includes("1234"), "les milliers doivent être séparés");
  });

  await cas("un modèle sans {n} est refusé — le compteur n'afficherait jamais rien", () => {
    const r = store.add(GUILD, "c-sans", "membres", "Membres du serveur");
    assert.strictEqual(r.ok, false);
    assert.ok(/\{n\}/.test(r.motif), r.motif);
  });

  console.log("\nLa cadence de renommage est respectée :");

  await cas("le premier renommage part tout de suite", async () => {
    counters.arreterTout();
    const c = salon("c1");
    assert.strictEqual(await counters.renommer(c, "Membres : 12", 0), "applique");
    assert.deepStrictEqual(c.applique, ["Membres : 12"]);
  });

  await cas("un second renommage AUSSITÔT APRÈS est différé, pas envoyé", async () => {
    // C'est tout l'enjeu : envoyé, il consommerait le quota de Discord et le
    // salon finirait figé sur une valeur périmée, sans erreur visible.
    counters.arreterTout();
    const c = salon("c2");
    await counters.renommer(c, "Membres : 12", 0);
    c.name = "Membres : 12";
    const suite = await counters.renommer(c, "Membres : 13", 1000);
    assert.strictEqual(suite, "programme");
    assert.deepStrictEqual(c.applique, ["Membres : 12"], "le second renommage ne doit PAS être parti");
  });

  await cas("une fois l'intervalle écoulé, le renommage repart", async () => {
    counters.arreterTout();
    const c = salon("c3");
    await counters.renommer(c, "Membres : 12", 0);
    c.name = "Membres : 12";
    assert.strictEqual(await counters.renommer(c, "Membres : 20", counters.INTERVALLE_MS + 1), "applique");
    assert.deepStrictEqual(c.applique, ["Membres : 12", "Membres : 20"]);
  });

  await cas("les demandes intermédiaires sont FUSIONNÉES — seule la dernière valeur compte", async () => {
    // Empiler les renommages appliquerait des valeurs périmées les unes après
    // les autres, chacune consommant du quota pour afficher un chiffre déjà
    // faux.
    counters.arreterTout();
    const c = salon("c4");
    await counters.renommer(c, "Membres : 1", 0);
    c.name = "Membres : 1";
    for (const n of [2, 3, 4, 5]) await counters.renommer(c, `Membres : ${n}`, 1000);
    assert.deepStrictEqual(c.applique, ["Membres : 1"], "aucun renommage supplémentaire ne doit être parti");
  });

  await cas("un nom déjà à jour ne consomme PAS de quota", async () => {
    counters.arreterTout();
    const c = salon("c5", "Membres : 12");
    assert.strictEqual(await counters.renommer(c, "Membres : 12", 0), "inchange");
    assert.deepStrictEqual(c.applique, []);
    // Et le quota reste donc disponible pour un vrai changement, tout de suite.
    assert.strictEqual(await counters.renommer(c, "Membres : 13", 1), "applique");
  });

  await cas("un refus de Discord ne fait pas planter la mise à jour", async () => {
    counters.arreterTout();
    const c = { id: "c6", name: "x", setName: async () => { throw new Error("Missing Permissions"); } };
    assert.strictEqual(await counters.renommer(c, "Membres : 1", 0), "impossible");
  });

  console.log("\nMise à jour d'un serveur complet :");

  await cas("chaque compteur enregistré reçoit sa valeur", async () => {
    counters.arreterTout();
    const s1 = salon("s-membres");
    const s2 = salon("s-boosts");
    const g = guilde({ membres: 10, bots: 2, boosts: 3, salons: [s1, s2] });
    store.add(GUILD, "s-membres", "membres", "Membres : {n}");
    store.add(GUILD, "s-boosts", "boosts", "Boosts : {n}");
    await counters.mettreAJour(g);
    assert.deepStrictEqual(s1.applique, ["Membres : 12"]);
    assert.deepStrictEqual(s2.applique, ["Boosts : 3"]);
  });

  await cas("un salon supprimé à la main est OUBLIÉ, pas recherché indéfiniment", async () => {
    counters.arreterTout();
    store.add(GUILD, "s-disparu", "bots", "Bots : {n}");
    assert.ok(store.list(GUILD).some((c) => c.channelId === "s-disparu"));
    // Le salon n'est plus dans le cache de la guilde : il a été supprimé.
    await counters.mettreAJour(guilde({ salons: [salon("s-membres"), salon("s-boosts")] }));
    assert.ok(!store.list(GUILD).some((c) => c.channelId === "s-disparu"), "l'entrée morte devait être retirée");
  });

  await cas("un serveur sans compteur ne déclenche aucun travail", async () => {
    counters.arreterTout();
    const s = salon("libre");
    await counters.mettreAJour(guilde({ salons: [s] }));
    assert.deepStrictEqual(s.applique, []);
  });

  console.log("\nBornes du magasin :");

  await cas("le même salon ne peut pas être compteur deux fois", () => {
    assert.strictEqual(store.add("g-b", "salon-x", "membres", "{n}").ok, true);
    assert.strictEqual(store.add("g-b", "salon-x", "bots", "{n}").ok, false);
  });

  await cas("un type inconnu est refusé", () => {
    assert.strictEqual(store.add("g-b", "salon-y", "enligne", "{n}").ok, false);
  });

  await cas("le nombre de compteurs par serveur est borné", () => {
    let cree = 0;
    for (let i = 0; i < store.MAX_PAR_SERVEUR + 5; i++) {
      if (store.add("g-plein", `s${i}`, "membres", "{n}").ok) cree++;
    }
    assert.strictEqual(cree, store.MAX_PAR_SERVEUR);
  });

  counters.arreterTout();
  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
