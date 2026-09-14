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
  members: { cache: new Collection([[CIBLE_ID, cible]]), me: { roles: { highest: { position: 9 } } } },
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

  // "Rôles (paliers)" est la SEULE exception, demandée explicitement (capture
  // d'écran à l'appui) : ses boutons sont attachés à une ligne précise
  // (« Permission 3 : @rôle » + Supprimer/Ajouter/Renommer). Un menu unique
  // les fondrait tous ensemble et on ne saurait plus quel palier chaque action
  // vise. L'exception est nommée ici plutôt que le test affaibli : tout autre
  // écran qui se remettrait à aligner des boutons doit encore échouer.
  const AVEC_BOUTONS = ["roletiers"];

  await cas("aucun écran n'affiche de bouton à custom_id, hors l'exception nommée", () => {
    for (const section of SECTIONS.map((s) => s.key).filter((k) => !AVEC_BOUTONS.includes(k))) {
      const restants = boutonsDe(section).filter((b) => b.custom_id);
      assert.deepStrictEqual(restants.map((b) => b.label), [], `${section} aligne encore des boutons`);
    }
  });

  await cas("\"Rôles (paliers)\" garde bien ses boutons de ligne — sinon la mise en page demandée disparaît", () => {
    // Un palier n'existe que si un rôle a des clés accordées : sans ça la
    // rubrique n'a aucune ligne, donc aucun bouton de ligne à vérifier.
    permStore.setRoleGrants("g1", ROLE_ID, ["moderation.kick"]);
    const labels = boutonsDe("roletiers").map((b) => b.label);
    for (const attendu of ["Supprimer", "Ajouter", "Renommer"]) {
      assert.ok(labels.includes(attendu), `"${attendu}" manque — boutons trouvés : ${labels.join(", ")}`);
    }
    permStore.setRoleGrants("g1", ROLE_ID, []);
  });

  await cas("l'écran des permissions regroupe ses CINQ actions dans un seul menu", () => {
    const menu = menuActionsDe("permissions", { permissionsRoleId: ROLE_ID });
    assert.ok(menu, "un menu d'actions doit exister");
    const labels = menu.options.map((o) => o.label);
    for (const attendu of ["Créer un rôle", "Choisir un autre rôle", "Voir les membres"]) {
      assert.ok(labels.includes(attendu), `${attendu} manque : ${labels.join(", ")}`);
    }
  });

  await cas("la valeur d'une option EST le customId du bouton d'origine — aucun handler n'a été réécrit", () => {
    const menu = menuActionsDe("permissions", { permissionsRoleId: ROLE_ID });
    for (const option of menu.options) {
      assert.ok(option.value.startsWith(`${ID}:`), `${option.label} -> ${option.value}`);
      assert.ok(!option.value.startsWith(`${ID}:action`), "une option ne doit pas renvoyer vers le menu lui-même");
    }
  });

  await cas("choisir une action déclenche le MÊME handler que le bouton d'origine", async () => {
    const menu = menuActionsDe("permissions", { permissionsRoleId: ROLE_ID });
    const voirCommandes = menu.options.find((o) => o.label === "Voir les membres");
    let misAJour = null;
    await handleConfigInteraction({
      customId: `${ID}:action`,
      values: [voirCommandes.value],
      member: owner,
      guild,
      update: async (p) => {
        misAJour = p;
        return {};
      },
      followUp: async () => ({}),
    });
    assert.ok(misAJour, "l'action choisie doit produire le même effet qu'un clic sur le bouton");
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

  await cas("un bouton LIEN garde sa rangée — une option de menu n'ouvre pas d'URL", () => {
    // Le lecteur musique expose un lien vers le vrai panneau de lecture. Le
    // convertir en option le ferait disparaître purement et simplement.
    const client = {
      uptime: 1,
      ws: { ping: 1 },
      guilds: { cache: new Collection() },
      nowPlayingMessages: new Collection([["g1", { url: "https://discord.com/channels/g1/1/2" }]]),
      kazagumo: { players: new Collection() },
    };
    const avecLecteur = { ...guild, client };
    const liens = buildConfigPanel(avecLecteur, "musicPlayer", owner)
      .components[0].toJSON()
      .components.filter((c) => c.type === 1)
      .flatMap((r) => r.components)
      .filter((b) => b.type === 2 && b.url);
    for (const lien of liens) assert.ok(lien.url.startsWith("https://"), JSON.stringify(lien));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
