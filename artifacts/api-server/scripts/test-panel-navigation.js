/**
 * Vérifie la navigation À UN SEUL NIVEAU de &panel (utils/configPanel.js) :
 *  - un seul menu "cfg:nav", qui liste directement les rubriques — plus de
 *    niveau "famille" ni de second menu "subnav" (chaque famille n'avait
 *    plus qu'une rubrique, le second niveau n'offrait jamais de choix) ;
 *  - chaque rubrique est atteignable exactement une fois ;
 *  - "Constructeur d'embed" et "Sondages" ne sont plus des rubriques (elles
 *    ne faisaient que rouvrir &embed / &poll, qui restent intactes) ;
 *  - une valeur de menu obsolète (panneau envoyé avant le changement)
 *    retombe proprement sur l'accueil.
 *
 * Lancement : node scripts/test-panel-navigation.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-navigation-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, SECTIONS, MENU, ID } = require("../utils/configPanel");
const { modHandlers } = require("../utils/musicCommands");
const permStore = require("./_levelGrants");

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

const guild = {
  id: "gnav",
  name: "Serveur",
  ownerId: "owner-x",
  memberCount: 0,
  roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};

function mkMember(id, roleId) {
  return {
    id,
    displayName: id,
    guild: { id: guild.id, ownerId: guild.ownerId },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

const owner = mkMember("owner-1");
const sectionKeys = SECTIONS.map((s) => s.key);

function navMenu(member, section = "home") {
  const json = buildConfigPanel(guild, section, member).components[0].toJSON();
  const menus = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  return { menus, nav: menus.find((c) => c.custom_id === `${ID}:nav`) };
}

/** Rubrique réellement ouverte par un choix dans le menu (via le vrai handler). */
async function ouvrir(member, valeur) {
  let payload = null;
  await handleConfigInteraction({
    customId: `${ID}:nav`,
    values: [valeur],
    member,
    guild,
    update: async (p) => {
      payload = p;
    },
    reply: async () => {},
  });
  return payload;
}

const memeEcran = (payload, section, member) =>
  JSON.stringify(payload.components.map((c) => c.toJSON())) ===
  JSON.stringify(buildConfigPanel(guild, section, member).components.map((c) => c.toJSON()));

(async () => {
  console.log("Navigation à un seul niveau :");

  await cas("un seul menu de navigation, aucun second menu de rubrique", () => {
    const { menus, nav } = navMenu(owner);
    assert.ok(nav, "le menu cfg:nav doit exister");
    assert.ok(!menus.some((c) => (c.custom_id || "").endsWith(":subnav")), "plus de second niveau");
    assert.strictEqual(nav.placeholder, "Choisir une rubrique");
    assert.ok(nav.options.length <= 25, `${nav.options.length} options — Discord en refuse plus de 25`);
  });

  await cas("chaque rubrique figure exactement une fois dans le menu, et inversement", () => {
    const sectionsDuMenu = MENU.map((e) => e.section);
    assert.strictEqual(new Set(sectionsDuMenu).size, sectionsDuMenu.length, "rubrique en double dans le menu");
    assert.strictEqual(new Set(MENU.map((e) => e.key)).size, MENU.length, "valeur de menu en double");
    assert.deepStrictEqual([...sectionsDuMenu].sort(), [...sectionKeys].sort());
  });

  await cas("le propriétaire voit toutes les rubriques, rubrique ouverte marquée", () => {
    const { nav } = navMenu(owner);
    assert.strictEqual(nav.options.length, MENU.length);
    assert.deepStrictEqual(
      nav.options.filter((o) => o.default).map((o) => o.value),
      ["accueil"]
    );
  });

  await cas("Constructeur d'embed et Sondages ne sont plus des rubriques du panel", () => {
    assert.ok(!sectionKeys.includes("embedBuilder"));
    assert.ok(!sectionKeys.includes("polls"));
    const labels = navMenu(owner).nav.options.map((o) => o.label);
    for (const retire of ["Sondages", "Annonces", "Constructeur d'embed"]) {
      assert.ok(!labels.includes(retire), `${retire} est encore proposé : ${labels.join(", ")}`);
    }
  });

  await cas("&embed et &poll restent des commandes routées", () => {
    assert.strictEqual(typeof modHandlers.embed, "function");
    assert.strictEqual(typeof modHandlers.poll, "function");
  });

  await cas("un membre limité ne voit que ses rubriques (Logs avec logs.view)", () => {
    permStore.setRoleGrants(guild.id, "role-logs", ["logs.view"]);
    const membre = mkMember("u-logs", "role-logs");
    const valeurs = navMenu(membre).nav.options.map((o) => o.value);
    assert.ok(valeurs.includes("logs"), valeurs.join(", "));
    assert.ok(!valeurs.includes("sys") && !valeurs.includes("banall"), valeurs.join(", "));
  });

  console.log("\nOuverture via le menu :");

  await cas("choisir une entrée ouvre directement sa rubrique (pas de détour par un sous-menu)", async () => {
    for (const [valeur, section] of [["logs", "logs"], ["bienvenue", "welcome"], ["banall", "banall"], ["dispenses", "moderation"]]) {
      const payload = await ouvrir(owner, valeur);
      assert.ok(payload, `${valeur} : le panneau doit être réaffiché`);
      assert.ok(memeEcran(payload, section, owner), `${valeur} devait ouvrir ${section}`);
    }
  });

  await cas("une valeur obsolète (ex-« sondages ») retombe sur l'accueil", async () => {
    const payload = await ouvrir(owner, "sondages");
    assert.ok(memeEcran(payload, "home", owner));
  });

  await cas("une rubrique non autorisée choisie à la main retombe sur l'accueil", async () => {
    const membre = mkMember("u-logs", "role-logs");
    const payload = await ouvrir(membre, "banall");
    assert.ok(memeEcran(payload, "home", membre));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
