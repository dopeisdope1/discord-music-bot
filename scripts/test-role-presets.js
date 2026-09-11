/**
 * Vérifie le provisionnement en masse des rôles (utils/rolePresets.js),
 * déclenché depuis le panel (rubrique "Rôles (paliers)") : demande explicite
 * pour créer/supprimer la hiérarchie de rôles vue sur les screens fournis
 * directement depuis un menu déroulant, sans script à part.
 *
 * Lancement : node scripts/test-role-presets.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "role-presets-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { createPresetRoles, deleteAllRoles, TOTAL_ROLES, TIERS } = require("../utils/rolePresets");
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

/** Fausse guild avec un guild.roles.create()/delete() qui manipulent VRAIMENT le cache, comme discord.js. */
function fakeGuild(id) {
  let n = 1;
  const botRole = { id: "role-bot-protect", name: "PROTECT", managed: true };
  const guild = {
    id,
    name: `Serveur ${id}`,
    members: { me: { permissions: { has: () => true }, roles: { botRole } } },
    roles: {
      cache: new Collection([
        [id, { id, name: "@everyone", managed: false }],
        [botRole.id, botRole], // rôle géré du bot lui-même, toujours déjà présent avant toute création
      ]), // @everyone : id du rôle = id de la guild
      create: async ({ name }) => {
        const role = {
          id: `role-${n++}`,
          name,
          managed: false,
          delete: async () => {
            guild.roles.cache.delete(role.id);
          },
        };
        guild.roles.cache.set(role.id, role);
        return role;
      },
    },
  };
  return guild;
}

function fakeMessage(guild, authorId = "owner-1") {
  const replies = [];
  return {
    author: { id: authorId, tag: `${authorId}#0001` },
    member: { id: authorId, guild: { id: guild.id }, roles: { cache: new Collection() } },
    guild,
    channel: { id: "chan-1" },
    reply: async (p) => {
      replies.push(p);
      return { id: "msg-1" };
    },
    _replies: replies,
  };
}

function extractConfirmToken(reply) {
  const row = reply.components[0].toJSON().components.find((c) => c.type === 1);
  const goButton = row.components.find((c) => c.custom_id.includes(":go:"));
  return goButton.custom_id.split(":").pop();
}

(async () => {
  console.log("&rolePresets — création :");

  await cas(`crée bien les ${TOTAL_ROLES} rôles, avec les grants et les exclusifs au bon endroit`, async () => {
    const guild = fakeGuild("g1");
    const message = fakeMessage(guild);
    await createPresetRoles({}, message);
    assert.strictEqual(message._replies.length, 1, "une confirmation doit être demandée avant de créer quoi que ce soit");
    assert.strictEqual(guild.roles.cache.size, 2, "rien n'est créé avant confirmation (@everyone + le rôle géré du bot)");

    const { handleConfirmInteraction } = require("../utils/serverAdminCommands");
    const token = extractConfirmToken(message._replies[0]);
    let updated = null;
    await handleConfirmInteraction({
      customId: `srv:confirm:go:${token}`,
      user: { id: "owner-1", tag: "owner-1#0001" },
      member: message.member,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.ok(updated, "un résultat final aurait dû être affiché");
    // +2 : @everyone et le rôle géré du bot étaient déjà présents.
    assert.strictEqual(guild.roles.cache.size, TOTAL_ROLES + 2, `les ${TOTAL_ROLES} rôles doivent tous exister`);

    const parNom = new Map([...guild.roles.cache.values()].map((r) => [r.name, r]));
    assert.ok(parNom.has("Perm I") && parNom.has("SECURE") && parNom.has("Couronne"));

    // Palier 3 ("Perm III") a exactement les clés attendues pour ce palier.
    assert.deepStrictEqual(permStore.getRoleGrants("g1", parNom.get("Perm III").id).sort(), [...TIERS[2].keys].sort());
    // Palier 1 ("Perm I") a AU MOINS une clé (snipe/absence n'en donnent
    // aucune, mais le palier doit quand même exister dans &perms/&helpall).
    assert.ok(permStore.getRoleGrants("g1", parNom.get("Perm I").id).length > 0);

    // Les 3 "hors hiérarchie" sont marqués EXCLUSIFS, avec leur propre nom.
    const gerant = [...guild.roles.cache.values()].find((r) => r.name === "🏅");
    assert.ok(gerant, "le rôle \"Gérant gestion\" (🏅) doit exister");
    assert.strictEqual(permStore.isRoleExclusive("g1", gerant.id), true);
    assert.strictEqual(permStore.getExclusiveLabel("g1", gerant.id), "Gérant gestion");
    assert.ok(permStore.getRoleGrants("g1", gerant.id).includes("moderation.ban"));

    // Le rôle géré du bot ("PROTECT") reçoit les mêmes clés que le palier 13
    // (le plus haut) : demande explicite, pour qu'il se retrouve groupé AVEC
    // "Permission 13" dans &perms plutôt que d'apparaître à part.
    assert.deepStrictEqual(
      permStore.getRoleGrants("g1", "role-bot-protect").sort(),
      [...TIERS[TIERS.length - 1].keys].sort()
    );
  });

  await cas("les 13 paliers ont des ensembles de clés TOUS DIFFÉRENTS (aucun ne se retrouve fondu avec un autre dans &perms)", () => {
    const signatures = TIERS.map((t) => [...t.keys].sort().join("|"));
    const doublons = signatures.filter((sig, i) => signatures.indexOf(sig) !== i);
    assert.deepStrictEqual(doublons, [], `des paliers partagent exactement les mêmes clés : ${doublons.join(", ")}`);
  });

  await cas("chaque palier a TOUTES les clés du précédent, plus au moins une nouvelle (logique cumulative)", () => {
    for (let i = 1; i < TIERS.length; i++) {
      const precedent = new Set(TIERS[i - 1].keys);
      const courant = new Set(TIERS[i].keys);
      const manquante = [...precedent].find((k) => !courant.has(k));
      assert.strictEqual(manquante, undefined, `le palier ${i + 1} doit garder "${manquante}" du palier ${i}`);
    }
  });

  await cas("sans le rang sys, ne fait rien", async () => {
    const guild = fakeGuild("g2");
    const message = fakeMessage(guild, "quidam-1");
    await createPresetRoles({}, message);
    assert.strictEqual(message._replies.length, 0);
    assert.strictEqual(guild.roles.cache.size, 2);
  });

  console.log("\n&rolePresets — suppression en masse :");

  await cas("supprime TOUS les rôles (sauf @everyone et les rôles gérés), après confirmation seulement", async () => {
    const guild = fakeGuild("g3");
    await guild.roles.create({ name: "rôle-a" });
    await guild.roles.create({ name: "rôle-b" });
    // Rôle géré par une intégration (ex : le rôle du bot lui-même) : jamais touché.
    guild.roles.cache.set("role-managed", { id: "role-managed", name: "Bot Managé", managed: true, delete: async () => { throw new Error("ne doit jamais être appelé"); } });

    const message = fakeMessage(guild);
    await deleteAllRoles({}, message);
    assert.strictEqual(message._replies.length, 1, "une confirmation doit être demandée");
    assert.strictEqual(guild.roles.cache.size, 5, "rien n'est supprimé avant confirmation");

    const { handleConfirmInteraction } = require("../utils/serverAdminCommands");
    const token = extractConfirmToken(message._replies[0]);
    let updated = null;
    await handleConfirmInteraction({
      customId: `srv:confirm:go:${token}`,
      user: { id: "owner-1", tag: "owner-1#0001" },
      member: message.member,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.ok(updated);
    assert.strictEqual(guild.roles.cache.size, 3, "@everyone et les deux rôles gérés doivent survivre, les deux autres non");
    assert.ok(guild.roles.cache.has("g3"), "@everyone ne doit jamais être supprimé");
    assert.ok(guild.roles.cache.has("role-managed"), "un rôle géré par une intégration ne doit jamais être supprimé");
    assert.ok(guild.roles.cache.has("role-bot-protect"), "le rôle géré du bot lui-même ne doit jamais être supprimé");
  });

  await cas("aucun rôle à supprimer (juste @everyone) : le dit clairement, ne demande pas de confirmation pour rien", async () => {
    const guild = fakeGuild("g4");
    const message = fakeMessage(guild);
    await deleteAllRoles({}, message);
    assert.ok(message._reply === undefined); // pas de champ direct, on relit _replies
    assert.strictEqual(message._replies.length, 1);
    assert.ok(message._replies[0].embeds[0].data.description.includes("Aucun rôle"));
  });

  await cas("sans le rang sys, ne fait rien", async () => {
    const guild = fakeGuild("g5");
    await guild.roles.create({ name: "rôle-a" });
    const message = fakeMessage(guild, "quidam-1");
    await deleteAllRoles({}, message);
    assert.strictEqual(message._replies.length, 0);
    assert.strictEqual(guild.roles.cache.size, 3);
  });

  console.log('\nMenu "Provisionnement en masse" dans le panel :');

  await cas("le menu n'apparaît QUE pour le rang sys", () => {
    const { buildConfigPanel } = require("../utils/configPanel");
    const guild = fakeGuild("g6");
    guild.channels = { cache: new Collection() };
    guild.emojis = { cache: new Collection() };
    guild.voiceStates = { cache: new Collection() };
    guild.client = { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } };
    guild.ownerId = "owner-1";
    guild.memberCount = 0;
    const { PermissionsBitField } = require("discord.js");
    guild.roles.everyone = { permissions: new PermissionsBitField([]) };

    permStore.setRoleGrants("g6", "role-perm-only", ["panel.permissions.manage"]);
    const membrePermSeule = { id: "u-perm", guild: { id: "g6" }, roles: { cache: new Collection([["role-perm-only", { id: "role-perm-only" }]]) }, user: { tag: "u-perm#0001" } };
    const owner = { id: "owner-1", guild: { id: "g6" }, roles: { cache: new Collection() }, user: { tag: "owner-1#0001" } };

    const jsonSansSys = buildConfigPanel(guild, "roletiers", membrePermSeule).components[0].toJSON();
    const jsonAvecSys = buildConfigPanel(guild, "roletiers", owner).components[0].toJSON();
    const optionsMenu = (json) =>
      json.components.filter((c) => c.type === 1).flatMap((r) => r.components).filter((c) => c.custom_id === `${ID}:rolepresets`);

    assert.strictEqual(optionsMenu(jsonSansSys).length, 0, "panel.permissions.manage seul ne doit PAS suffire");
    assert.strictEqual(optionsMenu(jsonAvecSys).length, 1, "le rang sys (propriétaire) doit voir le menu");
  });

  await cas('choisir "Créer les rôles" dans le menu lance bien la confirmation, DANS le panel', async () => {
    const guild = fakeGuild("g7");
    const owner = { id: "owner-1", guild: { id: "g7" }, roles: { cache: new Collection() }, user: { tag: "owner-1#0001" } };
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:rolepresets`,
      values: ["create"],
      member: owner,
      guild,
      client: {},
      channel: { id: "chan-1" },
      user: { id: "owner-1", tag: "owner-1#0001" },
      update: async (p) => (updated = p),
    });
    assert.ok(updated, "la confirmation doit remplacer le panel, pas ouvrir un second message");
    assert.strictEqual(guild.roles.cache.size, 2, "rien n'est créé avant confirmation");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
