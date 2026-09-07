/**
 * Vérifie que TOUTES les rubriques du panel sont dessinables et LISIBLES
 * (utils/sectionDashboard.js + utils/configPanel.js::buildSectionSpec).
 *
 * Le corps d'une rubrique est écrit pour Discord, qui résout `<@123>`,
 * `<#123>` et `<t:...>` à l'affichage. Un canvas, lui, ne résout RIEN :
 * dessiné tel quel, ce corps afficherait « <#1546335926219833466> » en toutes
 * lettres et « 🔴 » en carré vide (la police embarquée n'a aucun glyphe
 * emoji). L'image serait alors MOINS lisible que le texte qu'elle remplace —
 * l'inverse du but.
 *
 * Le test balaie donc les 28 rubriques et refuse qu'une seule laisse passer
 * une mention brute, un marqueur markdown ou un emoji. Il vaut pour les
 * rubriques d'aujourd'hui comme pour celles qu'on ajoutera : c'est le
 * catalogue réel (SECTIONS) qui est parcouru, pas une liste recopiée.
 *
 * Lancement : node scripts/test-section-dashboard.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sectiondash-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildSectionSpec, buildConfigPanel, SECTIONS } = require("../utils/configPanel");
const { resoudre, decouper, enSpec } = require("../utils/sectionDashboard");
const { rendre } = require("../utils/dashboardImage");

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

const estPNG = (buf) => Buffer.isBuffer(buf) && buf.subarray(1, 4).toString() === "PNG";

function makeGuild() {
  const everyone = { id: "g1", name: "@everyone", permissions: new PermissionsBitField([]) };
  return {
    id: "g1",
    name: "Serveur de test",
    ownerId: "owner-1",
    memberCount: 42,
    roles: {
      cache: new Collection([
        ["g1", everyone],
        // `permissions` et `managed` : computeSecurityScan inspecte chaque rôle.
        ["role-staff", { id: "role-staff", name: "Staff", managed: false, permissions: { has: () => false } }],
      ]),
      everyone,
    },
    channels: { cache: new Collection([["chan-1", { id: "chan-1", name: "general" }]]) },
    members: {
      cache: new Collection([["u-1", { id: "u-1", displayName: "uo067", user: { username: "uo067" } }]]),
      me: { roles: { highest: { position: 9 } } },
    },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 987654, ws: { ping: 17 }, guilds: { cache: new Collection() } },
  };
}

const guild = makeGuild();
const owner = {
  id: "owner-1",
  guild,
  roles: { cache: new Collection() },
  permissions: { has: () => true },
  displayName: "uo067",
};

/** Tout le texte réellement dessiné sur une rubrique. */
function texteDe(spec) {
  const morceaux = [spec.titre, spec.sousTitre, spec.pied || ""];
  for (const carte of spec.cartes) {
    morceaux.push(carte.titre || "", carte.vide || "");
    for (const item of carte.items) morceaux.push(item.nom, item.description || "");
  }
  return morceaux.filter(Boolean).join("\n");
}

// Emojis que la police embarquée ne sait pas dessiner : ils sortiraient en
// carrés vides. Plage large volontairement — c'est un filet, pas une liste
// exhaustive à tenir à jour.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

(async () => {
  console.log("Résolution de ce qu'un canvas ne sait pas afficher :");

  await cas("une mention de salon, de rôle ou de membre devient un NOM lisible", () => {
    const texte = resoudre("<#chan-1> · <@&role-staff> · <@u-1>", guild);
    assert.strictEqual(texte, "#general · @Staff · @uo067");
  });

  await cas("un identifiant inconnu ne laisse JAMAIS le nombre brut à l'écran", () => {
    const texte = resoudre("<#999> <@&999> <@999>", guild);
    assert.ok(!texte.includes("999"), texte);
    assert.ok(texte.includes("salon inconnu") && texte.includes("rôle inconnu") && texte.includes("membre inconnu"), texte);
  });

  await cas("un horodatage Discord devient une date lisible, pas un nombre de secondes", () => {
    const texte = resoudre("le <t:1757260800:R>", guild);
    assert.ok(!texte.includes("1757260800"), texte);
    assert.ok(/\d{2} \S+ \d{4}/.test(texte), texte);
  });

  await cas("les emojis custom du serveur sont retirés — ils ne se dessinent pas", () => {
    assert.strictEqual(resoudre("<:Lock:123> Anti-nuke", guild), "Anti-nuke");
    assert.strictEqual(resoudre("<a:StatusOnline:456> Logs", guild), "Logs");
  });

  await cas("les marqueurs markdown disparaissent — gras et code sont des attributs de dessin", () => {
    assert.strictEqual(resoudre("**Salon** : `#g` et *rien*", guild), "Salon : #g et rien");
  });

  console.log("\nDécoupage du corps d'une rubrique :");

  await cas("un réglage « Label : valeur » devient une ligne à deux niveaux", () => {
    const [bloc] = decouper("> **Salon** : #general", guild);
    assert.deepStrictEqual({ type: bloc.type, label: bloc.label, valeur: bloc.valeur }, { type: "reglage", label: "Salon", valeur: "#general" });
  });

  await cas("un en-tête sans valeur n'est PAS pris pour un réglage vide", () => {
    const [bloc] = decouper("**Messages** (un au hasard) :", guild);
    assert.strictEqual(bloc.type, "sousTitre");
  });

  await cas("l'emoji de gravité devient une pastille, qu'il soit devant le gras ou dedans", () => {
    const [devant] = decouper("🟠 **3** OK · **4** avertissement(s)", guild);
    const [dedans] = decouper("**🔴 Critiques :**", guild);
    assert.strictEqual(devant.couleur, "#fb923c");
    assert.strictEqual(dedans.couleur, "#ff6b6b");
    assert.strictEqual(dedans.texte, "Critiques");
  });

  await cas("une carte trop longue se prolonge au lieu de devenir un mur illisible", () => {
    const corps = Array.from({ length: 25 }, (_, i) => `> **Réglage ${i}** : valeur`).join("\n");
    const spec = enSpec(corps, { titre: "T", couleur: "#fff" });
    assert.ok(spec.cartes.length > 1, "les lignes doivent être réparties sur plusieurs cartes");
    assert.ok(spec.cartes.every((c) => c.items.length <= 9), spec.cartes.map((c) => c.items.length).join(","));
  });

  await cas("un en-tête coloré teinte sa carte — la gravité se lit d'un coup d'oeil", () => {
    const spec = enSpec("**🔴 Critiques :**\n> Une alerte grave", { titre: "T", couleur: "#94a3b8" });
    assert.strictEqual(spec.cartes.at(-1).couleur, "#ff6b6b");
  });

  console.log("\nToutes les rubriques du panel, sans exception :");

  const rubriques = SECTIONS.filter((s) => s.key !== "home");

  await cas(`les ${rubriques.length} rubriques produisent une spec dessinable`, () => {
    for (const s of rubriques) {
      const spec = buildSectionSpec(guild, s.key, owner);
      assert.ok(spec.cartes.length, `${s.key} : aucune carte`);
      assert.strictEqual(spec.titre, s.label, `${s.key} : le titre doit être celui du panel`);
    }
  });

  await cas("aucune rubrique ne laisse une mention BRUTE à l'écran", () => {
    for (const s of rubriques) {
      const texte = texteDe(buildSectionSpec(guild, s.key, owner));
      assert.ok(!/<[@#:aA]?[!&]?[\w:]*\d+>/.test(texte), `${s.key} laisse une mention brute :\n${texte}`);
      assert.ok(!/<t:\d+/.test(texte), `${s.key} laisse un horodatage brut :\n${texte}`);
    }
  });

  await cas("aucune rubrique ne laisse de marqueur markdown à dessiner", () => {
    for (const s of rubriques) {
      const texte = texteDe(buildSectionSpec(guild, s.key, owner));
      assert.ok(!texte.includes("**"), `${s.key} laisse du gras markdown :\n${texte}`);
      assert.ok(!texte.includes("`"), `${s.key} laisse du code markdown :\n${texte}`);
    }
  });

  await cas("aucune rubrique ne laisse d'emoji — la police embarquée n'en a aucun glyphe", () => {
    for (const s of rubriques) {
      const texte = texteDe(buildSectionSpec(guild, s.key, owner));
      const trouve = texte.match(EMOJI);
      assert.ok(!trouve, `${s.key} laisse l'emoji ${trouve?.[0]} :\n${texte}`);
    }
  });

  await cas("chaque rubrique se dessine réellement en PNG, aucune ne fait échouer le rendu", () => {
    for (const s of rubriques) {
      assert.ok(estPNG(rendre(buildSectionSpec(guild, s.key, owner))), `${s.key} ne produit pas de PNG`);
    }
  });

  await cas("le panel joint bien l'image sur chaque rubrique, jamais une galerie sans pièce jointe", () => {
    for (const s of rubriques) {
      const panel = buildConfigPanel(guild, s.key, owner);
      const composants = panel.components[0].toJSON().components;
      const galeries = composants.filter((c) => c.type === 12).length;
      assert.strictEqual(galeries, 1, `${s.key} : ${galeries} galerie(s)`);
      assert.strictEqual((panel.files || []).length, 1, `${s.key} : pièce jointe manquante`);
    }
  });

  await cas("sansImage : chaque rubrique retombe sur son texte d'origine, sans pièce jointe", () => {
    for (const s of rubriques) {
      const panel = buildConfigPanel(guild, s.key, owner, {}, { sansImage: true });
      const composants = panel.components[0].toJSON().components;
      assert.ok(!composants.some((c) => c.type === 12), `${s.key} garde une galerie sans image`);
      assert.strictEqual(panel.files, undefined, `${s.key} joint un fichier alors qu'il n'y a pas d'image`);
      assert.ok(composants.some((c) => c.type === 10), `${s.key} : plus rien à lire du tout`);
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
