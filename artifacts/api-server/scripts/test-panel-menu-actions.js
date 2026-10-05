/**
 * Vérifie que les actions de &panel sont regroupées dans UN menu déroulant au
 * lieu d'aligner des boutons (utils/configPanel.js::regrouperBoutonsEnMenu).
 * Demande explicite : « je veux plus de boutons interactifs, sinon ça fait
 * moche et trop d'options » — la fiche membre en alignait sept.
 *
 * Deux garde-fous comptent ici plus que le reste :
 *  - un bouton LIEN ne peut pas devenir une option de menu (une option
 *    n'ouvre pas d'URL) : sa rangée doit survivre telle quelle, sinon le lien
 *    disparaît sans que personne ne s'en aperçoive ;
 *  - choisir une action dans le menu doit déclencher EXACTEMENT le même
 *    handler que le bouton d'origine, sans réécrire aucun d'eux.
 *
 * Lancement : node scripts/test-panel-menu-actions.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-menu-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, ID, SECTIONS } = require("../utils/configPanel");
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

const CIBLE_ID = "935098876644454400";
const ROLE_ID = "1546335998529642628";

const cible = {
  id: CIBLE_ID,
  user: { tag: "diaqeek", username: "diaqeek", createdTimestamp: Date.now() - 1e10 },
  joinedTimestamp: Date.now() - 1e9,
  roles: { cache: new Collection() },
};
const role = { id: ROLE_ID, name: "bb", color: 0x5865f2, members: new Collection(), permissions: new PermissionsBitField([]) };
const guild = {
  id: "g1",
  name: "test",
  ownerId: "owner-1",
  memberCount: 3,
  roles: { cache: new Collection([[ROLE_ID, role]]), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection([[CIBLE_ID, cible]]), me: { roles: { highest: { position: 9 } }, permissions: new PermissionsBitField(PermissionsBitField.All) } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};
const owner = { id: "owner-1", guild: { id: "g1", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };

function composantsDe(section, state) {
  return buildConfigPanel(guild, section, owner, state)
    .components[0].toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((r) => r.components);
}
const menuActionsDe = (section, state) => composantsDe(section, state).find((c) => c.custom_id === `${ID}:action`);
const boutonsDe = (section, state) => composantsDe(section, state).filter((c) => c.type === 2);

(async () => {
  console.log("Les actions du panel tiennent dans un menu, pas dans une pile de boutons :");

  // Exceptions NOMMÉES, toutes justifiées dans utils/configPanel.js :
  //  - le bouton "Accueil" (cfg:home), présent sur chaque rubrique — « seule
  //    exception bouton restante » ;
  //  - la carte "Permissions", exclue du regroupement : ses boutons (pagination
  //    ←/→, cooldown) sont attachés à UNE section précise de la carte, qu'un
  //    menu unique fondrait ensemble.
  // "Rôles (paliers)" a quitté le panel pour &p (utils/palierPanel.js), où ses
  // boutons de ligne sont vérifiés plus bas. L'exception est nommée plutôt que
  // le test affaibli : tout autre écran qui se remettrait à aligner des
  // boutons doit encore échouer.
  const AVEC_BOUTONS = ["permissions"];

  await cas("aucun écran n'affiche de bouton à custom_id, hors les exceptions nommées", () => {
    for (const section of SECTIONS.map((s) => s.key).filter((k) => !AVEC_BOUTONS.includes(k))) {
      const restants = boutonsDe(section).filter((b) => b.custom_id && b.custom_id !== `${ID}:home`);
      assert.deepStrictEqual(restants.map((b) => b.label), [], `${section} aligne encore des boutons`);
    }
  });

  await cas("&p (Rôles par niveau) garde bien ses boutons de ligne — sinon la mise en page demandée disparaît", () => {
    const { buildPalierPanel } = require("../utils/palierPanel");
    // Une ligne n'existe que si un rôle a un niveau.
    permStore.setRoleGrants("g1", ROLE_ID, ["moderation.kick"]);
    const labels = buildPalierPanel(guild, owner)
      .components[0].toJSON()
      .components.filter((c) => c.type === 1)
      .flatMap((r) => r.components)
      .map((b) => b.label);
    for (const attendu of ["Supprimer", "Gérer", "Renommer"]) {
      assert.ok(labels.includes(attendu), `"${attendu}" manque — boutons trouvés : ${labels.join(", ")}`);
    }
    permStore.setRoleGrants("g1", ROLE_ID, []);
  });

  await cas("l'écran Logs regroupe ses actions dans un seul menu", () => {
    const menu = menuActionsDe("logs");
    assert.ok(menu, "un menu d'actions doit exister");
    const labels = menu.options.map((o) => o.label);
    for (const attendu of ["Créer les salons automatiquement", "Supprimer les salons de logs"]) {
      assert.ok(labels.includes(attendu), `${attendu} manque : ${labels.join(", ")}`);
    }
  });

  await cas("la valeur d'une option EST le customId du bouton d'origine — aucun handler n'a été réécrit", () => {
    const menu = menuActionsDe("logs");
    for (const option of menu.options) {
      assert.ok(option.value.startsWith(`${ID}:`), `${option.label} -> ${option.value}`);
      assert.ok(!option.value.startsWith(`${ID}:action`), "une option ne doit pas renvoyer vers le menu lui-même");
    }
  });

  await cas("choisir une action déclenche le MÊME handler que le bouton d'origine", async () => {
    const menu = menuActionsDe("logs");
    const supprimer = menu.options.find((o) => o.label === "Supprimer les salons de logs");
    let reponse = null;
    let misAJour = null;
    await handleConfigInteraction({
      customId: `${ID}:action`,
      values: [supprimer.value],
      member: owner,
      guild,
      reply: async (p) => {
        reponse = p;
        return {};
      },
      update: async (p) => {
        misAJour = p;
        return {};
      },
      followUp: async () => ({}),
    });
    // Aucun salon de logs configuré : le handler "logdelete" le dit, puis
    // réaffiche la rubrique — exactement comme un clic sur le bouton.
    assert.ok(reponse?.content?.includes("rien à supprimer"), JSON.stringify(reponse));
    assert.ok(misAJour, "l'écran Logs doit être réaffiché");
  });

  await cas("une valeur qui renvoie vers le menu lui-même ne provoque pas de boucle", async () => {
    let repondu = false;
    await handleConfigInteraction({
      customId: `${ID}:action`,
      values: [`${ID}:action`],
      member: owner,
      guild,
      update: async () => {
        repondu = true;
        return {};
      },
      reply: async () => {
        repondu = true;
        return {};
      },
      followUp: async () => ({}),
    });
    assert.strictEqual(repondu, false, "la valeur piégée doit être ignorée, pas réexpédiée sans fin");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
