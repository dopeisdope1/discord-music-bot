/**
 * Vérifie qu'AUCUN emoji décoratif ne subsiste dans &help ni dans &panel.
 *
 * Demande explicite : « enlève-moi ces emojis dégueulasses, la même dans le
 * panel, je veux des emojis juste pour les tickets/support ».
 *
 * La distinction tenue ici : un emoji sur un bouton que les MEMBRES cliquent
 * (« Ouvrir un ticket », « Participer ») est une icône fonctionnelle et reste ;
 * un emoji dans un menu de navigation de l'interface d'administration est
 * décoratif et part.
 *
 * Lancement : node scripts/test-sans-emoji.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sans-emoji-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, SECTIONS } = require("../utils/configPanel");
const { buildHelpPanel } = require("../utils/helpPanel");

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
const owner = {
  id: "owner-1",
  guild: { id: "g1", ownerId: "owner-1" },
  displayName: "dope",
  roles: { cache: new Collection() },
  permissions: { has: () => true },
};

/** Tous les composants d'un panneau, à plat, quelle que soit leur imbrication. */
function aPlat(noeud) {
  const trouves = [noeud];
  for (const enfant of noeud.components || []) trouves.push(...aPlat(enfant));
  if (noeud.accessory) trouves.push(...aPlat(noeud.accessory));
  for (const option of noeud.options || []) trouves.push(option);
  return trouves;
}

/** Les emojis portés par les composants (bouton, option de menu) d'un panneau. */
function emojisDe(panneau) {
  return aPlat(panneau.components[0].toJSON())
    .map((c) => c.emoji)
    .filter(Boolean)
    .map((e) => e.name || e.id);
}

console.log("&help : aucun emoji dans la navigation");

cas("le menu de &help n'affiche plus la maison, le globe, la clé ni le bouclier", () => {
  const emojis = emojisDe(buildHelpPanel("g1", owner, null, owner.id));
  assert.deepStrictEqual(emojis, [], `emojis restants : ${emojis.join(" ")}`);
});

cas("un palier ouvert n'en ramène pas non plus — ni sur la navigation, ni sur la pagination", () => {
  for (const palier of ["public", "configurable", "sys"]) {
    const emojis = emojisDe(buildHelpPanel("g1", owner, palier, owner.id, 0));
    assert.deepStrictEqual(emojis, [], `${palier} : ${emojis.join(" ")}`);
  }
});

console.log("\n&panel : aucun emoji, sur AUCUNE rubrique");

cas("toutes les rubriques du panel sont nettoyées, pas seulement l'accueil", () => {
  // Balayer les 27 rubriques et pas un échantillon : les emojis étaient
  // dispersés sur les boutons de chacune, et il en restait dans les recoins
  // les moins visités.
  const restants = [];
  for (const section of SECTIONS.map((s) => s.key)) {
    const emojis = emojisDe(buildConfigPanel(guild, section, owner));
    if (emojis.length) restants.push(`${section} → ${emojis.join(" ")}`);
  }
  assert.deepStrictEqual(restants, [], restants.join(" | "));
});

console.log("\nCe qui GARDE ses icônes : les boutons destinés aux membres");

cas("le bouton \"Ouvrir un ticket\" garde son icône — c'est un repère, pas une décoration", () => {
  // Il est posté dans un salon public, au milieu d'autres messages : sans
  // icône, il se fond dans le décor. C'est exactement l'exception demandée.
  const source = fs.readFileSync(path.join(__dirname, "..", "utils", "tickets.js"), "utf8");
  assert.ok(/Ouvrir un ticket[\s\S]{0,80}setEmoji/.test(source), "l'icône du bouton d'ouverture a disparu");
});

cas("le bouton \"Participer\" d'un giveaway aussi", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "utils", "giveaways.js"), "utf8");
  assert.ok(/Participer[\s\S]{0,80}setEmoji/.test(source), "l'icône du bouton de participation a disparu");
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
