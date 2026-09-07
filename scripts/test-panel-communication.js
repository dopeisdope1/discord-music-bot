/**
 * Vérifie la famille Communication du panel (module 7 de la refonte) :
 * Constructeur d'embed et Sondages n'existaient pas dans &panel, seulement en
 * commande (&embed, &poll). Chaque bouton doit ouvrir EXACTEMENT ce que la
 * commande ouvre déjà (même modale pour l'embed, même carte de formulaire
 * pour le sondage) — aucune deuxième implémentation.
 *
 * Lancement : node scripts/test-panel-communication.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-communication-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, ID } = require("../utils/configPanel");
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

const guild = {
  id: "gcomm",
  name: "Serveur",
  ownerId: "owner-1",
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
    guild: { id: "gcomm", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

(async () => {
  console.log("Communication — Embed et Sondages :");

  await cas("sans server.channels.manage, le Constructeur d'embed n'est pas proposé", () => {
    const noAccess = mkMember("u-none");
    const json = buildConfigPanel(guild, "embedBuilder", noAccess).components[0].toJSON();
    const titre = json.components.find((c) => c.type === 10).content;
    assert.ok(!titre.includes("Constructeur d'embed"), titre);
  });

  await cas("avec server.channels.manage, le bouton ouvre la MÊME modale que &embed", async () => {
    permStore.setRoleGrants("gcomm", "role-embed", ["server.channels.manage"]);
    const member = mkMember("u-embed", "role-embed");
    let modalShown = null;
    await handleConfigInteraction({
      customId: `${ID}:embedbuild`,
      member,
      guild,
      showModal: async (m) => {
        modalShown = m;
      },
      reply: async () => {},
    });
    assert.ok(modalShown, "une modale aurait dû s'ouvrir");
    assert.strictEqual(modalShown.toJSON().custom_id, "srvextra:embed");
  });

  await cas("sans server.polls.manage, la rubrique Sondages n'est pas proposée", () => {
    const noAccess = mkMember("u-none");
    const json = buildConfigPanel(guild, "polls", noAccess).components[0].toJSON();
    const titre = json.components.find((c) => c.type === 10).content;
    assert.ok(!titre.includes("Sondages"), titre);
  });

  await cas('avec server.polls.manage, "Créer un sondage" ouvre la MÊME carte que &poll (FORMS.poll_create)', async () => {
    permStore.setRoleGrants("gcomm", "role-poll", ["server.polls.manage"]);
    const member = mkMember("u-poll", "role-poll");
    let replied = null;
    await handleConfigInteraction({
      customId: `${ID}:pollstart`,
      member,
      guild,
      reply: async (p) => {
        replied = p;
      },
    });
    const texte = replied.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Créer un sondage"), texte);
  });

  await cas("avec un accès panel mais sans server.polls.manage, actionner directement pollstart reste refusé", async () => {
    permStore.setRoleGrants("gcomm", "role-other", ["logs.view"]);
    const otherAccess = mkMember("u-other", "role-other");
    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:pollstart`,
      member: otherAccess,
      guild,
      reply: async (p) => {
        refused = p;
      },
    });
    assert.ok(refused?.content?.includes("pas la permission"), JSON.stringify(refused));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
