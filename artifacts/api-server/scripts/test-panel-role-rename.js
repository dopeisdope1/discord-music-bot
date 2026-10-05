/**
 * Vérifie le bouton "Renommer" des RÔLES PAR NIVEAU (&p, utils/palierPanel.js).
 *
 * Il vivait auparavant dans &panel > Rôles et permissions ; ce parcours a été
 * remplacé par la carte à niveaux (commit 023ec29) et "Renommer" a déménagé
 * dans &p, avec Supprimer/Gérer, une ligne par niveau. Demande d'origine
 * inchangée : ne pas avoir à taper `&role rename` — cliquer doit ouvrir une
 * modale pré-remplie avec le nom actuel. Réutilise TEL QUEL
 * utils/serverAdminCommands.js::roleAdmin (même chemin que `&role rename`).
 *
 * Vérifie aussi que "Gérer" (attribuer/déplacer un niveau) est réservé au
 * propriétaire du bot, comme &set perm, &access et &panel > Permissions.
 *
 * Lancement : node scripts/test-panel-role-rename.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-role-rename-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField, MessageFlags } = require("discord.js");
const { buildPalierPanel, handlePalierInteraction, CUSTOM_ID } = require("../utils/palierPanel");
const levelStore = require("../utils/permissions/levelStore");
const accessStore = require("../utils/accessStore");

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

// Un vrai snowflake : roleAdmin résout la cible en cherchant un ID BRUT à
// 15-25 chiffres dans les args.
const ROLE_ID = "111111111111111111";
const AUTRE_ID = "222222222222222222";

function makeRole(id, name) {
  const role = {
    id,
    name,
    position: 1,
    hexColor: "#000000",
    members: { size: 0 },
    permissions: { toArray: () => [], has: () => false },
    setName: async (n) => {
      role.name = n;
      return role;
    },
    toString: () => `<@&${id}>`,
  };
  return role;
}

const role = makeRole(ROLE_ID, "Modérateur");
const autre = makeRole(AUTRE_ID, "Support");
const guild = {
  id: "grn",
  name: "Serveur",
  ownerId: "owner-1",
  roles: { cache: new Collection([[ROLE_ID, role], [AUTRE_ID, autre]]), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } }, permissions: { has: () => true } } },
};

function mkMember(id) {
  return {
    id,
    guild,
    roles: { cache: new Collection(), highest: { position: 10 } },
    permissions: { has: () => false },
    user: { id, tag: `${id}#0001` },
  };
}
const owner = mkMember("owner-1");
const sys = mkMember("sys-1");
const quidam = mkMember("quidam-1");
accessStore.add("sys", "sys-1");
levelStore.setRoleLevel("grn", ROLE_ID, 4);

const boutonsDe = (payload) =>
  payload.components[0]
    .toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((r) => r.components);
const lire = (n) => [n.content || "", ...(n.components || []).map(lire)].join("\n");
const texteDe = (payload) => payload.components.map((c) => lire(c.toJSON())).join("\n");

function interaction(member, customId, extra = {}) {
  return { customId, member, guild, client: {}, user: member.user, channel: { id: "chan-1" }, isModalSubmit: () => false, ...extra };
}

(async () => {
  console.log("&p — bouton \"Renommer\" :");

  await cas('le bouton "Renommer" apparaît sur la ligne du niveau, pour qui peut gérer les rôles', () => {
    const bouton = boutonsDe(buildPalierPanel(guild, owner)).find((b) => b.label === "Renommer");
    assert.ok(bouton, "le bouton Renommer doit être proposé");
    assert.strictEqual(bouton.custom_id, `${CUSTOM_ID}:ren:${ROLE_ID}`);
  });

  await cas("sans droit, la liste reste lisible mais AUCUN bouton n'apparaît", () => {
    const panel = buildPalierPanel(guild, quidam);
    assert.ok(texteDe(panel).includes(`<@&${ROLE_ID}>`), "la ligne du niveau reste affichée");
    assert.strictEqual(boutonsDe(panel).length, 0);
  });

  await cas("cliquer ouvre une modale PRÉ-REMPLIE avec le nom actuel", async () => {
    let modale = null;
    await handlePalierInteraction(interaction(owner, `${CUSTOM_ID}:ren:${ROLE_ID}`, { showModal: async (m) => (modale = m) }));
    assert.ok(modale, "une modale doit s'ouvrir");
    const champ = modale.toJSON().components[0].components[0];
    assert.strictEqual(champ.custom_id, "name");
    assert.strictEqual(champ.value, "Modérateur");
  });

  await cas("soumettre la modale renomme RÉELLEMENT le rôle et revient sur &p", async () => {
    let reponse = null;
    await handlePalierInteraction(
      interaction(owner, `${CUSTOM_ID}:ren:${ROLE_ID}`, {
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => "Modérateur en chef" },
        update: async (p) => (reponse = p),
      })
    );
    assert.strictEqual(role.name, "Modérateur en chef");
    const texte = texteDe(reponse);
    assert.ok(texte.includes("renommé"), texte);
    assert.ok(texte.includes("Rôles (niveaux)"), "doit revenir sur &p, pas rester sur la seule confirmation");
  });

  await cas("panneau en Components V2 : la réponse (embed classique) est convertie, pas refusée par Discord", async () => {
    let reponse = null;
    await handlePalierInteraction(
      interaction(owner, `${CUSTOM_ID}:ren:${ROLE_ID}`, {
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => "Modérateur en second" },
        message: { flags: { bitfield: Number(MessageFlags.IsComponentsV2) } },
        update: async (p) => (reponse = p),
      })
    );
    assert.strictEqual(role.name, "Modérateur en second");
    assert.strictEqual(reponse.embeds, undefined, "un `embeds` qui survit avec le flag V2 fait refuser tout le message");
    assert.ok(Number(reponse.flags) & Number(MessageFlags.IsComponentsV2), "le flag V2 doit être posé");
  });

  await cas("nom vide : rien n'est renommé, message d'erreur clair", async () => {
    const avant = role.name;
    let reponse = null;
    await handlePalierInteraction(
      interaction(owner, `${CUSTOM_ID}:ren:${ROLE_ID}`, {
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => "   " },
        reply: async (p) => (reponse = p),
      })
    );
    assert.strictEqual(role.name, avant);
    assert.ok(reponse?.content?.includes("vide"), JSON.stringify(reponse));
  });

  await cas("sans droit, l'action directe reste refusée", async () => {
    let refus = null;
    await handlePalierInteraction(interaction(quidam, `${CUSTOM_ID}:ren:${ROLE_ID}`, { reply: async (p) => (refus = p) }));
    assert.ok(refus?.content?.includes("pas la permission"), JSON.stringify(refus));
  });

  console.log("\n&p — \"Gérer\" (attribuer un niveau) réservé au propriétaire :");

  await cas('un rang sys voit Renommer/Supprimer, mais pas "Gérer"', () => {
    const labels = boutonsDe(buildPalierPanel(guild, sys)).map((b) => b.label);
    assert.ok(labels.includes("Renommer"), labels.join(", "));
    assert.ok(!labels.includes("Gérer"), labels.join(", "));
    assert.ok(boutonsDe(buildPalierPanel(guild, owner)).some((b) => b.label === "Gérer"), "le propriétaire, lui, l'a");
  });

  await cas("un rang sys ne peut ni attribuer ni déplacer un niveau, même par un customId direct", async () => {
    let refus = null;
    await handlePalierInteraction(interaction(sys, `${CUSTOM_ID}:add:n4:0`, { values: [AUTRE_ID], reply: async (p) => (refus = p) }));
    assert.ok(refus?.content?.includes("propriétaire"), JSON.stringify(refus));
    assert.strictEqual(levelStore.getRoleLevel("grn", AUTRE_ID), null, "aucun niveau attribué");

    refus = null;
    await handlePalierInteraction(interaction(sys, `${CUSTOM_ID}:move:${ROLE_ID}:0`, { values: ["9"], reply: async (p) => (refus = p) }));
    assert.ok(refus, "le déplacement doit être refusé");
    assert.strictEqual(levelStore.getRoleLevel("grn", ROLE_ID), 4, "le niveau n'a pas bougé");
  });

  await cas("le propriétaire déplace un rôle vers un autre niveau (persisté)", async () => {
    await handlePalierInteraction(interaction(owner, `${CUSTOM_ID}:move:${ROLE_ID}:0`, { values: ["6"], update: async () => {} }));
    assert.strictEqual(levelStore.getRoleLevel("grn", ROLE_ID), 6);
    const surDisque = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "permissionLevels.json"), "utf8"));
    assert.strictEqual(surDisque.grn.roleLevels[ROLE_ID], 6);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
