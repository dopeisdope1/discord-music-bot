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
const { buildConfigPanel, handleConfigInteraction, ID, SECTIONS: SECTIONS_META } = require("../utils/configPanel");
const permStore = require("../utils/permissions/store");

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

// Dérivée de la vraie liste, jamais recopiée : une rubrique ajoutée ou
// fusionnée est couverte sans que ce fichier ait à suivre.
const SECTIONS = SECTIONS_META.map((s) => s.key);

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

function render(section, state) {
  const json = buildConfigPanel(guild, section, member, state).components[0].toJSON();
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

  console.log("\n« Voir les commandes débloquées » (permissions > rôle) :");

  const roleId = "role-1";
  guild.roles.cache.set(roleId, { id: roleId, members: { size: 0 }, position: 1, hexColor: "#000000", permissions: { toArray: () => [] } });
  permStore.setRoleGrants("g1", roleId, ["server.stats.view"]);

  const fakeInteraction = (customId, extra = {}) => ({
    customId: `${ID}:${customId}`,
    member,
    guild,
    isModalSubmit: () => false,
    reply: async () => {},
    update: async () => {},
    ...extra,
  });

  await cas("sans rôle choisi, aucun bouton \"voir les commandes débloquées\"", () => {
    const json = buildConfigPanel(guild, "permissions", member).components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    assert.ok(!boutons.some((b) => b.custom_id?.includes("permshowcmds")), "le bouton ne devrait apparaître qu'une fois un rôle choisi");
  });

  await cas("un rôle choisi affiche le bouton \"Voir les commandes débloquées\"", () => {
    const json = buildConfigPanel(guild, "permissions", member, { permissionsRoleId: roleId }).components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const bouton = boutons.find((b) => b.custom_id === `${ID}:permshowcmds:${roleId}`);
    assert.ok(bouton, "le bouton \"voir les commandes débloquées\" est absent");
    assert.strictEqual(bouton.label, "Voir les commandes débloquées");
  });

  await cas("le comptage par catégorie ne dit QUE le nombre, jamais les commandes elles-mêmes", () => {
    const { texte } = render("permissions", { permissionsRoleId: roleId });
    assert.ok(texte.includes("Permissions du bot accordées"), texte);
    assert.ok(!texte.includes("Commandes débloquées par ce rôle"), "sans avoir cliqué sur le bouton, la liste ne doit pas apparaître");
    assert.ok(!texte.includes("`vc`"), "sans le bouton cliqué, aucune commande nommée ne doit apparaître");
  });

  await cas("cliquer sur le bouton révèle les VRAIES commandes débloquées, pas juste un compte", async () => {
    let panel = null;
    await handleConfigInteraction(
      fakeInteraction(`permshowcmds:${roleId}`, { update: async (p) => { panel = p; } })
    );
    const texte = panel.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Commandes débloquées par ce rôle"), texte);
    assert.ok(texte.includes("`vc`") || texte.includes("`stats`"), `attendu vc/stats (server.stats.view) : ${texte}`);
  });

  await cas("un second clic (déjà affiché) bascule vers \"Masquer\" et referme la liste", async () => {
    let panel = null;
    await handleConfigInteraction(
      fakeInteraction(`permhidecmds:${roleId}`, { update: async (p) => { panel = p; } })
    );
    const texte = panel.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(!texte.includes("Commandes débloquées par ce rôle"), "la liste devrait être repliée après un second clic");
    const boutons = panel.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const bouton = boutons.find((b) => b.custom_id === `${ID}:permshowcmds:${roleId}`);
    assert.ok(bouton, "le bouton doit repasser à \"Voir les commandes débloquées\" une fois replié");
  });

  console.log("\nNavigation regroupée par famille :");

  await cas("le menu principal propose des familles, pas les 16 rubriques", () => {
    const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
    const nav = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":nav"));
    assert.ok(nav, "le menu de navigation doit exister");
    assert.ok(nav.components[0].options.length <= 8, `${nav.components[0].options.length} entrées — c'est de nouveau une liste à faire défiler`);
    assert.ok(nav.components[0].options.length < SECTIONS.length, "il doit y avoir moins de familles que de rubriques");
  });

  await cas("un second menu apparaît pour choisir dans une famille qui en contient plusieurs", () => {
    const json = buildConfigPanel(guild, "sys", member).components[0].toJSON();
    const sub = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":subnav"));
    assert.ok(sub, "la famille Permissions et accès contient plusieurs rubriques");
    const valeurs = sub.components[0].options.map((o) => o.value);
    assert.ok(valeurs.includes("sys") && valeurs.includes("banall"));
  });

  await cas("aucun second menu quand la famille n'a qu'une rubrique", () => {
    const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
    assert.ok(!json.components.some((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":subnav")));
  });

  await cas("toutes les rubriques restent atteignables — aucune perdue au regroupement", () => {
    const atteignables = new Set();
    for (const section of SECTIONS) {
      const json = buildConfigPanel(guild, section, member).components[0].toJSON();
      const sub = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":subnav"));
      if (sub) for (const o of sub.components[0].options) atteignables.add(o.value);
      else atteignables.add(section);
    }
    for (const section of SECTIONS) {
      assert.ok(atteignables.has(section), `${section} n'est plus atteignable par la navigation`);
    }
  });

  await cas("chaque écran reste distinct — le regroupement n'a fusionné aucun contrôle", () => {
    // "Rang sys" donne accès à tout le bot, "Ban de masse" bannit le serveur
    // entier : même famille, jamais le même écran.
    const sys = render("sys");
    const banall = render("banall");
    assert.notStrictEqual(sys.texte, banall.texte);
    assert.ok(banall.texte.includes("bannit tout le serveur"));
    assert.ok(!sys.texte.includes("bannit tout le serveur"));
  });

  await cas("l'avertissement du ban de masse est conservé", () => {
    // Seule exception assumée : un mauvais clic y bannit le serveur entier.
    assert.ok(render("banall").texte.includes("bannit tout le serveur"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
