/**
 * Vérifie que &panel reste un POSTE DE COMMANDE et pas une documentation
 * (utils/configPanel.js::sectionBody).
 *
 * Demande explicite : "je veux que le panel soit juste un endroit pour les
 * interactifs et menus déroulants". Chaque rubrique n'affiche donc que
 * l'état courant — des lignes "> **Réglage** : valeur" — et les contrôles
 * qui le modifient. Les explications de fonctionnement vivent dans le README
 * et dans &help.
 *
 * Ce test garde la règle : il échoue si une rubrique se remet à expliquer au
 * lieu de montrer.
 *
 * Lancement : node scripts/test-panel-controls.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panelctrl-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { buildConfigPanel } = require("../utils/configPanel");

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

const SECTIONS = [
  "home", "prefixes", "moderation", "permissions", "roles", "logs", "history",
  "protection", "guard", "welcome", "mute", "tickets", "voice", "access", "sys", "banall",
];

const member = { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
const guild = {
  id: "g1",
  name: "Serveur",
  ownerId: "owner-1",
  roles: { cache: new Collection() },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
};

function render(section) {
  const json = buildConfigPanel(guild, section, member).components[0].toJSON();
  return {
    texte: json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n"),
    rangees: json.components.filter((c) => c.type === 1).length,
  };
}

(async () => {
  console.log("Le panel montre, il n'explique pas :");

  await cas("aucune rubrique ne dépasse 900 caractères de texte", () => {
    for (const section of SECTIONS) {
      const { texte } = render(section);
      assert.ok(texte.length <= 900, `${section} affiche ${texte.length} caractères — c'est de la documentation, pas un écran de contrôle`);
    }
  });

  await cas("chaque rubrique propose au moins le menu de navigation", () => {
    for (const section of SECTIONS) {
      assert.ok(render(section).rangees >= 1, `${section} n'a aucun contrôle`);
    }
  });

  await cas("toutes les rubriques de réglage ont un contrôle en plus de la navigation", () => {
    // "home" est la vue d'ensemble : son seul contrôle est le menu de
    // navigation, et c'est normal. Toutes les autres doivent offrir de quoi
    // agir sans avoir à taper une commande.
    for (const section of SECTIONS.filter((s) => s !== "home")) {
      assert.ok(render(section).rangees >= 2, `${section} n'offre aucun contrôle propre`);
    }
  });

  await cas("l'état courant reste affiché — sinon les contrôles agissent à l'aveugle", () => {
    for (const section of ["prefixes", "logs", "protection", "guard", "welcome", "mute", "tickets", "voice", "sys", "banall"]) {
      assert.ok(render(section).texte.includes(">"), `${section} n'affiche plus l'état courant`);
    }
  });

  await cas("le catalogue des permissions n'est plus recopié à côté de son menu", () => {
    // Il était listé en texte ET dans le menu déroulant qui coche les mêmes
    // clés : deux fois la même information, dont une seule cliquable.
    const { texte } = render("permissions");
    assert.ok(texte.length < 300, `${texte.length} caractères — le catalogue est probablement recopié`);
    assert.ok(!texte.includes("moderation.kick"), "les clés de permission n'ont pas à être listées en texte");
  });

  await cas("l'avertissement du ban de masse est conservé", () => {
    // Seule exception assumée : un mauvais clic y bannit le serveur entier.
    assert.ok(render("banall").texte.includes("bannit tout le serveur"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
