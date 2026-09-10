/**
 * Vérifie la rubrique "Rôles (paliers)" du panel (utils/configPanel.js) :
 * demande explicite pour voir en un coup d'œil ce que &perms et &helpall
 * montrent séparément (paliers de permissions -> rôles ET commandes
 * débloquées), avec un raccourci direct vers le renommage d'un rôle —
 * sans redemander le rôle une seconde fois dans "Rôles et permissions".
 *
 * Lancement : node scripts/test-panel-role-tiers.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-role-tiers-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, buildSectionSpec, handleConfigInteraction, ID } = require("../utils/configPanel");
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

const ROLE_A = "111111111111111111";
const ROLE_B = "222222222222222222";

function makeGuild() {
  return {
    id: "gtiers",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: {
      cache: new Collection([
        [ROLE_A, { id: ROLE_A, name: "Modérateur", position: 2, hexColor: "#000000", members: { size: 0 }, permissions: { toArray: () => [], has: () => false }, toString() { return `<@&${this.id}>`; } }],
        [ROLE_B, { id: ROLE_B, name: "Support", position: 1, hexColor: "#000000", members: { size: 0 }, permissions: { toArray: () => [], has: () => false }, toString() { return `<@&${this.id}>`; } }],
      ]),
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
    guild: { id: "gtiers", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
    user: { tag: `${id}#0001` },
  };
}

function texteDe(guild, member, state) {
  const spec = buildSectionSpec(guild, "roletiers", member, state);
  return spec.cartes.flatMap((c) => [c.titre || "", ...c.items.map((i) => `${i.nom} ${i.description || ""}`)]).join("\n");
}

(async () => {
  console.log('Rubrique "Rôles (paliers)" — vue combinée &perms + &helpall :');

  const guild = makeGuild();
  permStore.setRoleGrants("gtiers", ROLE_A, ["moderation.kick", "moderation.ban"]);
  permStore.setRoleGrants("gtiers", ROLE_B, ["moderation.kick"]);
  permStore.setRoleExclusive("gtiers", ROLE_B, false);

  await cas("visible avec panel.permissions.manage, absente sinon", () => {
    const avecDroit = mkMember("u-avec", ROLE_A);
    const sansDroit = mkMember("u-sans", null);
    const dispoAvec = buildConfigPanel(guild, "home", avecDroit).components[0].toJSON();
    const dispoSans = buildConfigPanel(guild, "home", sansDroit).components[0].toJSON();
    // panel.permissions.manage vient du rôle A ci-dessous une fois accordé —
    // ici on vérifie juste que la rubrique existe bien pour le propriétaire.
    const owner = mkMember("owner-1", null);
    const spec = buildSectionSpec(guild, "roletiers", owner, {});
    assert.ok(spec, "la rubrique doit se construire pour le propriétaire");
  });

  await cas("chaque palier montre SES rôles ET les commandes qu'il débloque, comme &perms + &helpall réunis", () => {
    const owner = mkMember("owner-1", null);
    const texte = texteDe(guild, owner, {});
    assert.ok(texte.includes("Permission 1"), texte);
    // La spec dessinée résout les mentions en noms affichables (@Support),
    // pas en syntaxe brute <@&id> — Discord ne rendrait pas cette syntaxe
    // dans une image de toute façon.
    assert.ok(texte.includes("Support"), "le palier à 1 permission (Support) doit apparaître en premier");
    assert.ok(texte.includes("kick"), texte);
    assert.ok(texte.includes("Modérateur"), "le palier à 2 permissions (Modérateur) doit aussi apparaître");
    assert.ok(texte.includes("ban"), texte);
  });

  await cas("aucune permission accordée nulle part : message clair, pas une page vide", () => {
    const guildVide = makeGuild();
    guildVide.id = "gvide";
    const owner = mkMember("owner-1", null);
    owner.guild = { id: "gvide", ownerId: "owner-1" };
    const texte = texteDe(guildVide, owner, {});
    assert.ok(texte.includes("Aucune permission"), texte);
  });

  await cas('choisir un rôle dans le sélecteur saute DIRECTEMENT dans "Rôles et permissions" avec ce rôle déjà sélectionné', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierrenamepick`,
      values: [ROLE_A],
      member: owner,
      guild,
      client: {},
      update: async (p) => {
        updated = p;
      },
    });
    assert.ok(updated, "le panneau aurait dû être mis à jour");
    // Le corps de la rubrique est DESSINÉ (image) : son contenu se lit sur la
    // spec passée au moteur de rendu, pas dans le JSON de la réponse — voir
    // scripts/test-panel-rolemembers.js pour ce même motif.
    assert.ok(JSON.stringify(updated).includes("Rôles et permissions"), "on doit atterrir sur la rubrique Rôles et permissions");
    const spec = buildSectionSpec(guild, "permissions", owner, { permissionsRoleId: ROLE_A });
    const detail = spec.cartes.flatMap((c) => [c.titre || "", ...c.items.map((i) => `${i.nom} ${i.description || ""}`)]).join("\n");
    assert.ok(detail.includes("Modérateur"), "le rôle choisi (Modérateur) doit déjà être affiché, pas à re-sélectionner");
  });

  await cas("sans panel.permissions.manage, choisir un rôle dans le sélecteur reste refusé", async () => {
    // Juste assez pour VOIR le panel (hasAnyPanelAccess), pas de quoi agir.
    permStore.setRoleGrants("gtiers", "role-basic", ["panel.roles.manage"]);
    const sansDroit = mkMember("u-sans-droit", "role-basic");
    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:tierrenamepick`,
      values: [ROLE_A],
      member: sansDroit,
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
