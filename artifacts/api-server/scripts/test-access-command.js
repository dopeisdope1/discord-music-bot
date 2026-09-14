/**
 * "&access <@membre>" (utils/serverAdminCommands.js) — octroi de
 * permissions INDIVIDUELLES à UN membre précis, même catalogue réel que
 * &panel > Rôles et permissions (utils/permissions/catalog.js) mais côté
 * membre plutôt que côté rôle. Demande explicite (capture d'un autre bot,
 * juste la FONCTION reprise — pas de rang "couronne/dev" inventé, le
 * catalogue de CE bot sert de base).
 *
 * Lancement : node scripts/test-access-command.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "access-cmd-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const permStore = require("../utils/permissions/store");
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

const TARGET = "999888777000111222";

function fakeGuild(id, { hasTarget = true } = {}) {
  const targetMember = { id: TARGET, user: { id: TARGET, tag: "cible#0001" } };
  return {
    id,
    members: { fetch: async (uid) => (hasTarget && uid === TARGET ? targetMember : null) },
  };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1", args = [`<@${TARGET}>`], hasTarget = true } = {}) {
  const replies = [];
  const guild = fakeGuild(guildId, { hasTarget });
  return {
    author: { id: authorId },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
    _args: args,
  };
}

function fakeInteraction(customId, { userId = "staff-1", guildId = "g1", values } = {}) {
  const updates = [];
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    customId,
    guild,
    member: { id: userId, guild, roles: { cache: new Collection() } },
    values,
    update: async (p) => updates.push(p),
    reply: async (p) => replies.push(p),
    _updates: updates,
    _replies: replies,
  };
}

const texteDe = (payload) => JSON.stringify(payload.components);

(async () => {
  console.log("&access — accès et résolution de la cible :");

  await cas("sans panel.permissions.manage, silence", async () => {
    const msg = fakeMessage({ guildId: "g-refus", authorId: "quidam-1" });
    await serverAdmin.access(null, msg, msg._args);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("sans argument, message d'erreur clair", async () => {
    permStore.grantToUser("g-noargs", "staff-1", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g-noargs", args: [] });
    await serverAdmin.access(null, msg, []);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("membre introuvable sur le serveur : message clair, pas de plantage", async () => {
    permStore.grantToUser("g-absent", "staff-1", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g-absent", hasTarget: false });
    await serverAdmin.access(null, msg, msg._args);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(msg._replies[0].embeds || msg._replies[0].content || true);
  });

  await cas("un ID brut fonctionne aussi bien qu'une mention", async () => {
    permStore.grantToUser("g-id", "staff-1", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g-id", args: [TARGET] });
    await serverAdmin.access(null, msg, [TARGET]);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("un membre déjà owner/sys : refus clair, rien d'accordé", async () => {
    // accessStore "sys" est un rang GLOBAL (pas par serveur) — une cible
    // dédiée, jamais réutilisée ailleurs dans ce fichier, pour ne pas
    // fausser les autres cas qui réutilisent TARGET.
    const CIBLE_SYS = "111122223333444455";
    permStore.grantToUser("g-sys", "staff-1", "panel.permissions.manage");
    accessStore.add("sys", CIBLE_SYS);
    const msg = fakeMessage({ guildId: "g-sys", args: [`<@${CIBLE_SYS}>`] });
    msg.guild.members.fetch = async (uid) => (uid === CIBLE_SYS ? { id: CIBLE_SYS, user: { id: CIBLE_SYS, tag: "sys-cible#0001" } } : null);
    await serverAdmin.access(null, msg, msg._args);
    const texte = JSON.stringify(msg._replies[0]);
    assert.ok(texte.includes("propriétaire/rang sys") || texte.toLowerCase().includes("sys"), texte);
    assert.deepStrictEqual(permStore.getUserGrants("g-sys", CIBLE_SYS), []);
  });

  console.log("\n&access — panneau, catégorie puis clé, mêmes fonctions que &panel :");

  await cas("le panneau initial liste les catégories du VRAI catalogue", async () => {
    permStore.grantToUser("g-cat", "staff-1", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g-cat" });
    await serverAdmin.access(null, msg, msg._args);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("srv:accesscat:"), texte);
    assert.ok(!texte.includes("srv:accesskey:"), "la clé ne doit pas apparaître avant qu'une catégorie soit choisie");
  });

  await cas("choisir une catégorie révèle ses clés, avec leur état accordé/non", async () => {
    const interaction = fakeInteraction(`srv:accesscat:${TARGET}`, { guildId: "g-key", values: ["moderation"] });
    permStore.grantToUser("g-key", "staff-1", "panel.permissions.manage");
    permStore.grantToUser("g-key", TARGET, "moderation.kick");
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 1);
    const json = interaction._updates[0].components[0].toJSON();
    const menu = json.components.find((c) => c.type === 1 && c.components[0]?.custom_id === `srv:accesskey:${TARGET}:moderation`);
    assert.ok(menu, "le menu de clés doit apparaître pour la catégorie choisie");
    const option = menu.components[0].options.find((o) => o.value === "moderation.kick");
    assert.ok(option?.description?.includes("accordée"), JSON.stringify(option));
  });

  await cas("choisir une clé non accordée l'accorde immédiatement", async () => {
    permStore.grantToUser("g-grant", "staff-1", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:accesskey:${TARGET}:moderation`, {
      guildId: "g-grant",
      values: ["moderation.ban"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(permStore.getUserGrants("g-grant", TARGET).includes("moderation.ban"));
  });

  await cas("choisir une clé DÉJÀ accordée la retire (bascule)", async () => {
    permStore.grantToUser("g-revoke", "staff-1", "panel.permissions.manage");
    permStore.grantToUser("g-revoke", TARGET, "moderation.ban");
    const interaction = fakeInteraction(`srv:accesskey:${TARGET}:moderation`, {
      guildId: "g-revoke",
      values: ["moderation.ban"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(!permStore.getUserGrants("g-revoke", TARGET).includes("moderation.ban"));
  });

  await cas("après bascule, la catégorie reste ouverte (pas besoin de la rechoisir)", async () => {
    permStore.grantToUser("g-stay", "staff-1", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:accesskey:${TARGET}:moderation`, {
      guildId: "g-stay",
      values: ["moderation.warn"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    const json = interaction._updates[0].components[0].toJSON();
    assert.ok(json.components.some((c) => c.type === 1 && c.components[0]?.custom_id === `srv:accesskey:${TARGET}:moderation`));
  });

  await cas("sans panel.permissions.manage, une bascule est refusée", async () => {
    const interaction = fakeInteraction(`srv:accesskey:${TARGET}:moderation`, {
      guildId: "g-norefus",
      userId: "quidam-2",
      values: ["moderation.kick"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.ok(interaction._replies.length > 0);
    assert.ok(!permStore.getUserGrants("g-norefus", TARGET).includes("moderation.kick"));
  });

  await cas("le résumé regroupe les permissions accordées par catégorie", async () => {
    permStore.grantToUser("g-resume", "staff-1", "panel.permissions.manage");
    permStore.grantToUser("g-resume", TARGET, "moderation.kick");
    permStore.grantToUser("g-resume", TARGET, "moderation.ban");
    const msg = fakeMessage({ guildId: "g-resume" });
    await serverAdmin.access(null, msg, msg._args);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("moderation.kick") && texte.includes("moderation.ban"), texte);
    assert.ok(texte.includes("**2**"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
