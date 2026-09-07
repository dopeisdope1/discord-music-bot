/**
 * Vérifie l'ajout du lien "rôle -> membres" dans la rubrique Rôles et
 * permissions du panel (module 5 de la refonte) : &rolemembers existait déjà
 * en commande mais n'était jamais exposé dans &panel. Le bouton doit
 * réutiliser TEL QUEL utilityHandlers.rolemembers (même liste paginée), pas
 * une deuxième implémentation, et rester gated par server.members.list.
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

const ROLE_ID = "role-perm-1";

function makeGuild() {
  return {
    id: "grm",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: {
      cache: new Collection([[ROLE_ID, { id: ROLE_ID, name: "Modérateur", members: { size: 0 }, position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } }]]),
      everyone: { permissions: new PermissionsBitField([]) },
    },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "grm", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

/**
 * Les actions d'un écran sont désormais les options d'un menu déroulant
 * unique (`cfg:action`) et non plus des boutons. La valeur de chaque option
 * EST le customId du bouton d'origine : les assertions restent les mêmes.
 */
function buttons(guild, member, state) {
  const json = buildConfigPanel(guild, "permissions", member, state).components[0].toJSON();
  const composants = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  const actions = composants
    .filter((c) => c.custom_id === `${ID}:action`)
    .flatMap((menu) => menu.options)
    .map((o) => ({ label: o.label, custom_id: o.value }));
  return [...composants.filter((c) => c.custom_id !== `${ID}:action`), ...actions];
}

(async () => {
  console.log("Rôles et permissions — lien vers les membres du rôle :");

  const guild = makeGuild();

  await cas("sans server.members.list, aucun bouton \"Voir les membres\"", () => {
    permStore.setRoleGrants("grm", "role-basic", ["panel.roles.manage"]);
    const member = mkMember("u-basic", "role-basic");
    const labels = buttons(guild, member, { permissionsRoleId: ROLE_ID }).map((b) => b.label).filter(Boolean);
    assert.ok(!labels.includes("Voir les membres"), labels.join(", "));
  });

  await cas("avec server.members.list, le bouton apparaît et poste la VRAIE liste (utilityHandlers.rolemembers)", async () => {
    permStore.setRoleGrants("grm", "role-list", ["panel.roles.manage", "server.members.list"]);
    const member = mkMember("u-list", "role-list");
    const boutons = buttons(guild, member, { permissionsRoleId: ROLE_ID });
    const bouton = boutons.find((b) => b.label === "Voir les membres");
    assert.ok(bouton, "le bouton doit apparaître avec server.members.list");
    assert.strictEqual(bouton.custom_id, `${ID}:rolemembers:${ROLE_ID}`);

    let updated = null;
    let followedUp = null;
    await handleConfigInteraction({
      customId: bouton.custom_id,
      member,
      guild,
      client: {},
      update: async (p) => {
        updated = p;
      },
      followUp: async (p) => {
        followedUp = p;
        return {};
      },
    });
    assert.ok(updated, "le panel doit rester sur la rubrique Rôles et permissions");
    const texte = followedUp.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Membres du rôle Modérateur"), texte);
    // Régression fakeMessage (module 5) : le flag Ephemeral ne doit pas
    // écraser IsComponentsV2, sinon Discord refuserait ce message.
    const { MessageFlags } = require("discord.js");
    assert.ok((followedUp.flags & MessageFlags.IsComponentsV2) === MessageFlags.IsComponentsV2, followedUp.flags);
  });

  await cas("sans server.members.list, actionner directement le bouton reste refusé", async () => {
    const member = mkMember("u-basic", "role-basic");
    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:rolemembers:${ROLE_ID}`,
      member,
      guild,
      client: {},
      reply: async (p) => {
        refused = p;
      },
    });
    assert.ok(refused?.content?.includes("pas la permission"), JSON.stringify(refused));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
