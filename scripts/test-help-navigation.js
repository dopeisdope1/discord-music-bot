/**
 * Vérifie la navigation en trois niveaux de &help (catégorie -> palier ->
 * page, voir utils/helpPanel.js::handleHelpInteraction) : signalé comme
 * "toujours trop de commandes listées" et "structure à revoir" même après
 * la correction des identités ambiguës — une catégorie dense empilait ses
 * trois paliers (jusqu'à 33 commandes) sur un seul écran.
 *
 * Lancement : node scripts/test-help-navigation.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "helpnav-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, MessageFlags } = require("discord.js");
const { handleHelpInteraction } = require("../utils/helpPanel");

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

const member = { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };

function fakeInteraction(customId, values, { ephemeral } = {}) {
  const replies = [];
  let updated = null;
  return {
    customId,
    values,
    guild: { id: "g1" },
    member,
    message: { flags: { has: (f) => (ephemeral ? f === MessageFlags.Ephemeral : false) } },
    reply: async (p) => {
      replies.push(p);
      return p;
    },
    update: async (p) => {
      updated = p;
      return p;
    },
    _replies: replies,
    get _updated() {
      return updated;
    },
  };
}

const bodyOf = (payload) => payload.components[0].toJSON().components[2]?.content || "";
const tierSelectIn = (payload) =>
  payload.components[0].toJSON().components.find((c) => c.type === 1 && c.components[0]?.custom_id?.startsWith("help_tier:"));
const pageSelectIn = (payload) =>
  payload.components[0].toJSON().components.find((c) => c.type === 1 && c.components[0]?.custom_id?.startsWith("help_page:"));

(async () => {
  console.log("Sélection de catégorie :");

  await cas("choisir une catégorie depuis l'accueil ouvre son premier palier non vide", async () => {
    const i = fakeInteraction("help_nav", ["server"]);
    await handleHelpInteraction(i);
    const payload = i._replies[0];
    assert.ok(bodyOf(payload).includes("choose"), bodyOf(payload));
  });

  console.log("\nSélection de palier :");

  await cas("changer de palier depuis une catégorie affiche bien les commandes de CE palier", async () => {
    const i = fakeInteraction("help_tier:server", ["configurable"]);
    await handleHelpInteraction(i);
    const body = bodyOf(i._replies[0]);
    assert.ok(body.includes("role create"), body);
    assert.ok(!body.includes("`choose"), "le palier public ne doit plus apparaître");
  });

  await cas("le sélecteur de palier liste bien les paliers non vides avec leur effectif", async () => {
    const i = fakeInteraction("help_tier:server", ["configurable"]);
    await handleHelpInteraction(i);
    const select = tierSelectIn(i._replies[0]);
    const options = select.components[0].options.map((o) => o.label);
    assert.ok(options.some((l) => l.includes("publiques")));
    assert.ok(options.some((l) => l.includes("configurables")));
  });

  await cas("un seul palier non vide -> aucun sélecteur de palier n'apparaît (rien à choisir)", () => {
    // Vérifié directement sur le mécanisme plutôt que sur une catégorie
    // réelle : le catalogue actuel documente toujours au moins une commande
    // sans backend par catégorie (palier "documented" jamais vide), donc le
    // cas "un seul palier" n'existe pour l'instant sur aucune catégorie
    // réelle — mais la règle doit tenir dès qu'il s'en présente une.
    const { buildHelpPanel: build } = require("../utils/helpPanel");
    const commandCatalog = require("../utils/commandCatalog");
    const original = commandCatalog.CATEGORIES.find((c) => c.key === "server");
    const savedCommands = original.commands;
    original.commands = original.commands.filter((c) => c.name === "choose <option1>,,<option2>,,...");
    try {
      const panel = build("g1", member, "server");
      assert.strictEqual(tierSelectIn(panel), undefined, "un seul palier ne doit montrer aucun sélecteur");
    } finally {
      original.commands = savedCommands;
    }
  });

  console.log("\nPagination :");

  await cas("une liste de plus de 8 commandes se pagine, le sélecteur de page apparaît", async () => {
    const i = fakeInteraction("help_tier:server", ["configurable"]);
    await handleHelpInteraction(i);
    const select = pageSelectIn(i._replies[0]);
    assert.ok(select, "sélecteur de page manquant");
    assert.ok(select.components[0].placeholder.startsWith("Page 1/"), select.components[0].placeholder);
  });

  await cas("changer de page affiche bien des commandes DIFFÉRENTES de la page précédente", async () => {
    const page0 = fakeInteraction("help_page:server:configurable", ["0"]);
    await handleHelpInteraction(page0);
    const page1 = fakeInteraction("help_page:server:configurable", ["1"]);
    await handleHelpInteraction(page1);
    assert.notStrictEqual(bodyOf(page0._replies[0]), bodyOf(page1._replies[0]));
  });

  await cas("un palier court (moins de 9 commandes) n'affiche pas de sélecteur de page", async () => {
    // Palier "public" de "server" : seulement choose/embed.
    const i = fakeInteraction("help_tier:server", ["public"]);
    await handleHelpInteraction(i);
    assert.strictEqual(pageSelectIn(i._replies[0]), undefined);
  });

  console.log("\nÉphémère vs message public (deux personnes, deux droits différents) :");

  await cas("premier clic sur le message PUBLIC -> nouvelle réponse éphémère", async () => {
    const i = fakeInteraction("help_nav", ["utilitaire"], { ephemeral: false });
    await handleHelpInteraction(i);
    assert.strictEqual(i._replies.length, 1);
    assert.ok(i._replies[0].flags & MessageFlags.Ephemeral);
    assert.strictEqual(i._updated, null);
  });

  await cas("clic suivant sur SA carte déjà éphémère -> édition en place, pas d'empilement", async () => {
    const i = fakeInteraction("help_tier:utilitaire", ["sys"], { ephemeral: true });
    await handleHelpInteraction(i);
    assert.strictEqual(i._replies.length, 0);
    assert.ok(i._updated, "aucune édition en place n'a eu lieu");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
