/**
 * Texte alternatif des images du bot.
 *
 * &help et les rubriques de &panel répondent par une IMAGE. Sans texte
 * alternatif, quelqu'un qui ne la voit pas — images désactivées, connexion
 * lente, lecteur d'écran — ne reçoit strictement RIEN. Un bot dont l'aide est
 * une image le rend indispensable : c'est la seule porte d'entrée pour
 * découvrir ce qu'il sait faire.
 *
 * Le repli en texte (`enTexte`) ne couvre pas ce cas : il ne se déclenche que
 * si l'image n'a pas pu être DESSINÉE ou ENVOYÉE. Une image bien envoyée mais
 * jamais affichée chez le lecteur passait entre les mailles.
 *
 * Lancement : node scripts/test-texte-alternatif.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "alt-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildHelpPanel } = require("../utils/helpPanel");
const { buildConfigPanel, SECTIONS } = require("../utils/configPanel");
const { texteAlternatif } = require("../utils/dashboardImage");

// Discord plafonne le texte alternatif d'une pièce jointe à 1024 caractères ;
// au-delà, c'est tout le message qui est refusé.
const ALT_MAX = 1024;

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

const membre = {
  id: "owner-1",
  guild: { id: "g1", ownerId: "owner-1" },
  displayName: "dope",
  roles: { cache: new Collection() },
  permissions: { has: () => true },
};
const guild = {
  id: "g1",
  name: "test",
  ownerId: "owner-1",
  memberCount: 3,
  roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};

console.log("Chaque image envoyée porte son texte alternatif :");

cas("&help — accueil", () => {
  const panneau = buildHelpPanel("g1", membre, null, membre.id);
  const alt = panneau.files[0].description;
  assert.ok(alt, "l'image de &help doit décrire son contenu");
  assert.ok(alt.includes("Commandes publiques"), alt);
});

cas("&help — un palier ouvert décrit ses commandes, pas seulement son titre", () => {
  const panneau = buildHelpPanel("g1", membre, "configurable", membre.id, 0);
  const alt = panneau.files[0].description;
  assert.ok(/&\w/.test(alt), `des commandes doivent apparaître : ${alt}`);
});

cas("TOUTES les rubriques de &panel, pas seulement celles qu'on pense à tester", () => {
  const sans = [];
  for (const section of SECTIONS.map((s) => s.key)) {
    const panneau = buildConfigPanel(guild, section, membre);
    for (const fichier of panneau.files || []) {
      if (!fichier.description) sans.push(section);
    }
  }
  assert.deepStrictEqual(sans, [], `rubriques dont l'image est muette : ${sans.join(", ")}`);
});

console.log("\nLe texte alternatif reste valide pour Discord :");

cas("jamais au-delà de 1024 caractères — sinon tout le message est refusé", () => {
  const trop = {
    titre: "Titre",
    cartes: [{ titre: "Carte", items: Array.from({ length: 400 }, (_, i) => ({ nom: `&commande${i}`, description: "une description bien longue" })) }],
  };
  const alt = texteAlternatif(trop);
  assert.ok(alt.length <= ALT_MAX, `${alt.length} caractères`);
  assert.ok(alt.endsWith("…"), "la coupe doit être visible, pas silencieuse");
});

cas("aucune rubrique réelle ne dépasse le plafond", () => {
  for (const section of SECTIONS.map((s) => s.key)) {
    for (const fichier of buildConfigPanel(guild, section, membre).files || []) {
      assert.ok(fichier.description.length <= ALT_MAX, `${section} : ${fichier.description.length} caractères`);
    }
  }
});

cas("une spec vide ne produit pas un texte alternatif vide", () => {
  // Une description vide vaut absence de description côté Discord : autant le
  // savoir ici plutôt que de croire l'image décrite.
  const alt = texteAlternatif({ titre: "Rien à afficher", cartes: [{ titre: "Vide", items: [], vide: "Aucun réglage" }] });
  assert.ok(alt.includes("Rien à afficher"), alt);
  assert.ok(alt.includes("Aucun réglage"), "le message de carte vide doit être repris");
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
