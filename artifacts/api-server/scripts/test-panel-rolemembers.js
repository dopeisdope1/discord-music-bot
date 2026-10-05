/**
 * "Rôle -> membres" : où le trouver, et ce qu'il advient de l'ancien bouton.
 *
 * Le bouton "Voir les membres" vivait dans &panel > Rôles et permissions ; ce
 * parcours a été remplacé par la carte à niveaux (commit 023ec29). La liste
 * reste disponible par la commande &rolemembers (utilityHandlers.rolemembers,
 * même gate server.members.list). Ce test vérifie :
 *  - que la carte Permissions actuelle ne propose plus ce bouton ;
 *  - qu'un clic sur l'ancien bouton d'un panneau resté affiché reçoit une
 *    réponse claire, au lieu de « Échec de l'interaction » ;
 *  - que &rolemembers reste gated par server.members.list, débloquée par un
 *    NIVEAU (système actuel).
 * Le contenu de la liste elle-même est vérifié par test-utility-commands.js.
 *
 * Lancement : node scripts/test-panel-rolemembers.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-rolemembers-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, ID } = require("../utils/configPanel");
const { utilityHandlers } = require("../utils/utilityCommands");
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

const ROLE_ID = "333333333333333333";

const guild = {
  id: "grm",
  name: "Serveur",
  ownerId: "owner-1",
  memberCount: 0,
  roles: {
    cache: new Collection([[ROLE_ID, { id: ROLE_ID, name: "Modérateur", members: new Collection(), position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } }]]),
    everyone: { permissions: new PermissionsBitField([]) },
  },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } }, fetch: async () => new Collection() },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};

function mkMember(id, roleId) {
  return {
    id,
    guild,
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

function makeMessage(member, args) {
  const replies = [];
  return {
    author: { id: member.id, tag: `${member.id}#0001` },
    member,
    guild,
    channel: { id: "chan-1", send: async (p) => (replies.push(p), {}) },
    mentions: { roles: new Collection(args[0] === `<@&${ROLE_ID}>` ? [[ROLE_ID, guild.roles.cache.get(ROLE_ID)]] : []), members: new Collection(), users: new Collection() },
    reply: async (p) => {
      replies.push(p);
      return { edit: async () => {} };
    },
    _replies: replies,
  };
}

(async () => {
  console.log("Rôle -> membres :");

  const owner = mkMember("owner-1");

  await cas("la carte Permissions actuelle ne propose plus de bouton \"Voir les membres\"", () => {
    const json = buildConfigPanel(guild, "permissions", owner).components[0].toJSON();
    const ids = JSON.stringify(json);
    assert.ok(!ids.includes(`${ID}:rolemembers`), "plus de customId rolemembers dans le panel");
  });

  await cas("un clic sur l'ancien bouton d'un panneau resté affiché reçoit une réponse claire", async () => {
    let reponse = null;
    await handleConfigInteraction({
      customId: `${ID}:rolemembers:${ROLE_ID}`,
      member: owner,
      guild,
      client: {},
      isModalSubmit: () => false,
      reply: async (p) => {
        reponse = p;
      },
      update: async () => {
        throw new Error("ne doit pas réafficher un écran au hasard");
      },
    });
    assert.ok(reponse?.content?.includes("&panel"), JSON.stringify(reponse));
  });

  await cas("&rolemembers est débloquée par un niveau portant server.members.list", async () => {
    permStore.setRoleGrants("grm", "role-list", ["server.members.list"]);
    const msg = makeMessage(mkMember("u-list", "role-list"), [`<@&${ROLE_ID}>`]);
    await utilityHandlers.rolemembers(null, msg, [`<@&${ROLE_ID}>`]);
    assert.strictEqual(msg._replies.length, 1, "la liste doit être postée");
  });

  await cas("sans server.members.list, &rolemembers reste muette (aucune fuite de la liste)", async () => {
    const msg = makeMessage(mkMember("u-rien"), [`<@&${ROLE_ID}>`]);
    await utilityHandlers.rolemembers(null, msg, [`<@&${ROLE_ID}>`]);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
