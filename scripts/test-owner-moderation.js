/**
 * "&owner <@membre>" (utils/serverAdminCommands.js::ownerModeration, mot
 * "owner" enregistré dans modHandlers d'utils/musicCommands.js) — carte
 * "Owner" (buildOwnerAccessCard) filtrée aux catégories RÉELLES de
 * MODÉRATION du catalogue (moderation/channels/members/logs) : jamais les
 * catégories protection/panel/serveur, qui n'ont rien à faire dans un menu
 * "modération". Même mécanisme que "=add" (utils/permissions/store.js +
 * catalog.js), juste une présentation filtrée en plus.
 *
 * Lancement : node scripts/test-owner-moderation.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "owner-moderation-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const permStore = require("../utils/permissions/store");
const { getPrefixes } = require("../utils/prefixStore");

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

function fakeGuild(id) {
  const targetMember = { id: TARGET, user: { id: TARGET, tag: "cible#0001" } };
  return { id, members: { fetch: async (uid) => (uid === TARGET ? targetMember : null) } };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1" } = {}) {
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

function fakeInteraction(customId, { userId = "staff-1", guildId = "g1", values } = {}) {
  const updates = [];
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    customId,
    guild,
    user: { id: userId, tag: `${userId}#0000` },
    member: { id: userId, guild, roles: { cache: new Collection() } },
    values,
    update: async (p) => updates.push(p),
    reply: async (p) => replies.push(p),
    _updates: updates,
    _replies: replies,
  };
}

(async () => {
  console.log("\"&owner\" — dispatch via modHandlers, comme n'importe quelle vraie commande \"&\" :");

  await cas("le préfixe \"&\" (musicMod) est bien distinct de \"=\" et \"!!\"", () => {
    const { musicMod, owner, protection } = getPrefixes("g-quelconque");
    assert.strictEqual(musicMod, "&");
    assert.notStrictEqual(musicMod, owner);
    assert.notStrictEqual(musicMod, protection);
  });

  await cas("sans panel.permissions.manage, silence", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "u1" });
    await serverAdmin.ownerModeration(null, msg, [`<@${TARGET}>`]);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("avec la permission, ouvre la carte \"Owner\"", async () => {
    permStore.grantToUser("g2", "staff-2", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g2", authorId: "staff-2" });
    await serverAdmin.ownerModeration(null, msg, [`<@${TARGET}>`]);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("## Owner"), texte);
  });

  console.log("\nFiltrage réel aux catégories de modération :");

  await cas("le sélecteur de catégories ne liste QUE Modération/Salons/Membres/Logs", async () => {
    permStore.grantToUser("g3", "staff-3", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g3", authorId: "staff-3" });
    await serverAdmin.ownerModeration(null, msg, [`<@${TARGET}>`]);
    const texte = JSON.stringify(msg._replies[0].components);
    for (const label of ["Modération", "Salons", "Membres", "Logs"]) {
      assert.ok(texte.includes(label), `catégorie attendue manquante : ${label}`);
    }
    for (const label of ["Panel", "Protection", "Serveur"]) {
      assert.ok(!texte.includes(`"label":"${label}"`), `catégorie interdite présente : ${label}\n${texte}`);
    }
  });

  await cas("une permission de sécurité (protection.*) déjà accordée n'apparaît PAS dans le résumé", async () => {
    permStore.grantToUser("g4", "staff-4", "panel.permissions.manage");
    permStore.grantToUser("g4", TARGET, "protection.automod");
    permStore.grantToUser("g4", TARGET, "moderation.kick");
    const msg = fakeMessage({ guildId: "g4", authorId: "staff-4" });
    await serverAdmin.ownerModeration(null, msg, [`<@${TARGET}>`]);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("Accès attribués — 1"), texte); // seule moderation.kick compte
    assert.ok(!texte.includes("protection.automod"), texte);
  });

  await cas("choisir la catégorie \"protection\" est impossible : elle n'existe pas dans ce sélecteur", async () => {
    permStore.grantToUser("g5", "staff-5", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:modownercat:${TARGET}`, { userId: "staff-5", guildId: "g5", values: ["protection"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    // Discord empêcherait déjà ce choix (option absente du menu) ; côté bot,
    // la carte re-rendue ne doit simplement jamais ouvrir de 2e menu pour une
    // catégorie hors filtre.
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(!texte.includes("srv:modownerkey"), texte);
  });

  await cas("choisir \"moderation\" révèle bien ses clés, avec le bon customId dédié", async () => {
    permStore.grantToUser("g6", "staff-6", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:modownercat:${TARGET}`, { userId: "staff-6", guildId: "g6", values: ["moderation"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("srv:modownerkey"), texte);
  });

  await cas("accorder une clé de modération via \"srv:modownerkey\" fonctionne réellement", async () => {
    permStore.grantToUser("g7", "staff-7", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:modownerkey:${TARGET}:moderation`, {
      userId: "staff-7",
      guildId: "g7",
      values: ["moderation.warn"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(permStore.getUserGrants("g7", TARGET).includes("moderation.warn"));
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Accès attribués — 1"), texte);
  });

  await cas("le filtre reste appliqué après bascule (pas de retour au catalogue complet)", async () => {
    permStore.grantToUser("g8", "staff-8", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:modownerkey:${TARGET}:moderation`, {
      userId: "staff-8",
      guildId: "g8",
      values: ["moderation.ban"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    for (const label of ["Panel", "Protection", "Serveur"]) {
      assert.ok(!texte.includes(`"label":"${label}"`), `catégorie interdite réapparue : ${label}`);
    }
  });

  console.log("\nIsolation des préfixes / interactions :");

  await cas("\"srv:ownercat\"/\"srv:ownerkey\" (=add, catalogue complet) restent un dispatch SÉPARÉ de \"modowner\"", async () => {
    permStore.grantToUser("g9", "staff-9", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:ownercat:${TARGET}`, { userId: "staff-9", guildId: "g9", values: ["protection"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    // "=add" autorise bien "protection" (catalogue complet) : preuve que les deux dispatch ne se marchent pas dessus.
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("srv:ownerkey"), texte);
  });

  await cas("sans panel.permissions.manage, \"srv:modownerkey\" est refusé", async () => {
    const interaction = fakeInteraction(`srv:modownerkey:${TARGET}:moderation`, {
      userId: "sans-perm",
      guildId: "g10",
      values: ["moderation.ban"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.strictEqual(interaction._replies.length, 1);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
