/**
 * "&owners" (utils/serverAdminCommands.js) — carte dédiée demandée
 * explicitement (capture d'écran d'un autre bot, juste le STYLE repris) :
 * titre "👑 Liste Owner", compteur/page en évidence, liste numérotée
 * "01 @membre `id`", pagination par BOUTONS Précédent/Suivant plutôt que le
 * menu déroulant générique de utils/listCard.js (gardé tel quel pour les
 * autres listes — whitelist, bots, admins, boosters...).
 *
 * Lancement : node scripts/test-owners-card.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "owners-card-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { owners, handleServerAdminInteraction } = require("../utils/serverAdminCommands");
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

function fakeMessage(authorId) {
  const replies = [];
  return { author: { id: authorId }, reply: async (p) => replies.push(p), _replies: replies };
}

function fakeInteraction(customId, { userId = "owner-1", values } = {}) {
  const updates = [];
  const replies = [];
  return {
    customId,
    user: { id: userId },
    values,
    update: async (p) => updates.push(p),
    reply: async (p) => replies.push(p),
    _updates: updates,
    _replies: replies,
  };
}

const texteDe = (payload) => JSON.stringify(payload.components);

(async () => {
  console.log("&owners — accès :");

  await cas("ni sys ni owner : silence", async () => {
    const msg = fakeMessage("quidam-1");
    await owners(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("le propriétaire peut ouvrir la carte", async () => {
    const msg = fakeMessage("owner-1");
    await owners(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("le rang sys peut aussi l'ouvrir", async () => {
    accessStore.add("sys", "sys-1");
    const msg = fakeMessage("sys-1");
    await owners(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  console.log("\n&owners — présentation demandée :");

  await cas("titre couronné, compteur total et page en évidence", async () => {
    accessStore.add("sys", "sys-a");
    accessStore.add("sys", "sys-b");
    const msg = fakeMessage("owner-1");
    await owners(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("👑 Liste Owner"), texte);
    assert.ok(texte.includes("Utilisateur total"), texte);
    assert.ok(/Page.*1\/1/.test(texte), texte);
  });

  await cas("liste numérotée 01/02 avec mention ET id bruts", async () => {
    const msg = fakeMessage("owner-1");
    await owners(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("01") && texte.includes("02"), texte);
    assert.ok(texte.includes("sys-a") && texte.includes("sys-b"), texte);
  });

  await cas("pagination par BOUTONS (pas de menu déroulant)", async () => {
    for (let i = 0; i < 12; i++) accessStore.add("sys", `sys-page-${i}`);
    const msg = fakeMessage("owner-1");
    await owners(null, msg);
    const json = msg._replies[0].components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1 && c.components[0]?.type === 2).flatMap((r) => r.components);
    assert.ok(boutons.some((b) => b.custom_id?.startsWith("srv:ownerspage:")), JSON.stringify(boutons));
    assert.ok(boutons.find((b) => b.label === "Précédent")?.disabled, "page 1 : Précédent doit être désactivé");
    assert.ok(!boutons.find((b) => b.label === "Suivant")?.disabled, "page 1/2 : Suivant doit rester actif");
  });

  console.log("\n&owners — interactions :");

  await cas("le bouton Suivant change bien de page", async () => {
    const interaction = fakeInteraction("srv:ownerspage:1", { userId: "owner-1" });
    await handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 1);
    const texte = texteDe(interaction._updates[0]);
    assert.ok(/Page.*2\/2/.test(texte), texte);
  });

  await cas("sans permission, le clic sur la pagination est refusé", async () => {
    const interaction = fakeInteraction("srv:ownerspage:1", { userId: "quidam-2" });
    await handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.ok(interaction._replies.length > 0);
  });

  await cas("ajouter quelqu'un via le select réaffiche la MÊME carte stylée", async () => {
    const interaction = fakeInteraction("srv:add:owners", { userId: "owner-1", values: ["nouveau-1"] });
    await handleServerAdminInteraction(interaction);
    assert.ok(accessStore.list("sys").includes("nouveau-1"));
    const texte = texteDe(interaction._updates[0]);
    assert.ok(texte.includes("👑 Liste Owner"), texte);
  });

  await cas("seul le propriétaire voit les sélecteurs Ajouter/Retirer", async () => {
    const msgSys = fakeMessage("sys-1");
    await owners(null, msgSys);
    const texteSys = texteDe(msgSys._replies[0]);
    assert.ok(!texteSys.includes("srv:add:owners"), "le rang sys ne doit pas pouvoir ajouter");

    const msgOwner = fakeMessage("owner-1");
    await owners(null, msgOwner);
    const texteOwner = texteDe(msgOwner._replies[0]);
    assert.ok(texteOwner.includes("srv:add:owners") && texteOwner.includes("srv:del:owners"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
