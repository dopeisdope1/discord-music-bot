/**
 * Vérifie le bouton "Renommer" de la rubrique Rôles et permissions du panel
 * (utils/configPanel.js) : demande explicite pour ne pas avoir à taper
 * `&role rename` — cliquer un rôle dans le panel doit permettre de le
 * renommer directement, via une modale Discord pré-remplie avec le nom
 * actuel. Réutilise TEL QUEL utils/serverAdminCommands.js::roleAdmin (même
 * chemin que `&role rename`), pas une deuxième implémentation.
 *
 * Lancement : node scripts/test-panel-role-rename.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-role-rename-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { handleConfigInteraction, ID } = require("../utils/configPanel");
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

// Un vrai snowflake (que des chiffres) : roleAdmin résout la cible en cherchant
// un ID BRUT à 15-25 chiffres dans les args (messageFromInteraction ne peuple
// jamais mentions.roles) — voir utils/serverAdminCommands.js:240.
const ROLE_ID = "111111111111111111";

function makeRole(name) {
  const role = {
    id: ROLE_ID,
    name,
    position: 1,
    hexColor: "#000000",
    members: { size: 0 },
    permissions: { toArray: () => [], has: () => false },
    setName: async (n) => {
      role.name = n;
      return role;
    },
  };
  return role;
}

function makeGuild(role) {
  return {
    id: "grn",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: {
      cache: new Collection([[ROLE_ID, role]]),
      everyone: { permissions: new PermissionsBitField([]) },
    },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } }, permissions: { has: () => true } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "grn", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
    user: { tag: `${id}#0001` },
  };
}

/** Les rangées de boutons du panel sont regroupées en UN menu déroulant (cfg:action) ; on lit les options. */
function actionOptions(guild, member, state) {
  const { buildConfigPanel } = require("../utils/configPanel");
  const json = buildConfigPanel(guild, "permissions", member, state).components[0].toJSON();
  const menus = json.components.filter((c) => c.type === 1).flatMap((r) => r.components).filter((c) => c.custom_id === `${ID}:action`);
  return menus.flatMap((menu) => menu.options).map((o) => ({ label: o.label, custom_id: o.value }));
}

(async () => {
  console.log("Rôles et permissions — bouton \"Renommer\" :");

  const role = makeRole("Modérateur");
  const guild = makeGuild(role);
  // Voir le bouton exige panel.permissions.manage (c'est "peutModifier" dans
  // configPanel.js, même gate que "Supprimer ce rôle"/"Ajouter à l'exclusif") ;
  // l'ACTION elle-même, une fois cliquée, revérifie server.roles.manage (même
  // droit que la commande texte &role rename). Un rôle réel en aurait besoin
  // des deux ; on les donne ensemble ici.
  permStore.setRoleGrants("grn", "role-manage", ["panel.permissions.manage", "server.roles.manage"]);
  // Juste assez pour VOIR la rubrique (hasAnyPanelAccess), mais pas de quoi
  // modifier quoi que ce soit — le cas négatif du bouton.
  permStore.setRoleGrants("grn", "role-basic", ["panel.roles.manage"]);

  await cas('le bouton "Renommer" apparaît avec panel.permissions.manage', () => {
    const member = mkMember("u-manage", "role-manage");
    const options = actionOptions(guild, member, { permissionsRoleId: ROLE_ID });
    const bouton = options.find((o) => o.label === "Renommer");
    assert.ok(bouton, options.map((o) => o.label).join(", "));
    assert.strictEqual(bouton.custom_id, `${ID}:renamerole:${ROLE_ID}`);
  });

  await cas('sans server.roles.manage, le bouton "Renommer" n\'apparaît pas', () => {
    const member = mkMember("u-basic", "role-basic");
    const options = actionOptions(guild, member, { permissionsRoleId: ROLE_ID });
    assert.ok(!options.some((o) => o.label === "Renommer"), options.map((o) => o.label).join(", "));
  });

  await cas("cliquer ouvre une modale PRÉ-REMPLIE avec le nom actuel", async () => {
    const member = mkMember("u-manage", "role-manage");
    let modaleOuverte = null;
    await handleConfigInteraction({
      customId: `${ID}:renamerole:${ROLE_ID}`,
      member,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async (m) => {
        modaleOuverte = m;
      },
    });
    assert.ok(modaleOuverte, "une modale doit s'ouvrir");
    const champ = modaleOuverte.toJSON().components[0].components[0];
    assert.strictEqual(champ.custom_id, "name");
    assert.strictEqual(champ.value, "Modérateur");
  });

  await cas("soumettre la modale renomme RÉELLEMENT le rôle (même chemin que &role rename)", async () => {
    const member = mkMember("u-manage", "role-manage");
    let reponse = null;
    await handleConfigInteraction({
      customId: `${ID}:renamerole:${ROLE_ID}`,
      member,
      guild,
      client: {},
      user: member.user,
      channel: { id: "chan-1" },
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "Modérateur en chef" },
      // update(), pas reply() : le succès passe par roleAdmin ->
      // messageFromInteraction, qui remplace le panneau (voir configPanel.js).
      update: async (p) => {
        reponse = p;
      },
    });
    assert.strictEqual(role.name, "Modérateur en chef");
    assert.ok(reponse?.embeds?.[0]?.data?.description?.includes("renommé"), JSON.stringify(reponse));
  });

  await cas("nom vide : rien n'est renommé, message d'erreur clair", async () => {
    const member = mkMember("u-manage", "role-manage");
    const nomAvant = role.name;
    let reponse = null;
    await handleConfigInteraction({
      customId: `${ID}:renamerole:${ROLE_ID}`,
      member,
      guild,
      client: {},
      user: member.user,
      channel: { id: "chan-1" },
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "   " },
      reply: async (p) => {
        reponse = p;
      },
    });
    assert.strictEqual(role.name, nomAvant);
    assert.ok(reponse?.content?.includes("vide"), JSON.stringify(reponse));
  });

  await cas("sans server.roles.manage, l'action directe reste refusée", async () => {
    const member = mkMember("u-basic", "role-basic");
    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:renamerole:${ROLE_ID}`,
      member,
      guild,
      client: {},
      isModalSubmit: () => false,
      reply: async (p) => {
        refused = p;
      },
    });
    assert.ok(refused?.content?.includes("pas la permission"), JSON.stringify(refused));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
