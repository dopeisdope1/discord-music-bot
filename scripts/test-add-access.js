/**
 * "=add <@membre>" (utils/serverAdminCommands.js::handleAddAccessTextCommand
 * + buildOwnerAccessCard) — anciennement nommée "=owner", renommée pour
 * libérer ce mot au profit du transfert de propriété d'un salon vocal (voir
 * scripts/test-owner-voice.js). Demandée sur une capture d'un AUTRE bot
 * (commandes "follow"/"pv"/"wakeup"/"dog"... qui n'existent PAS ici), avec
 * sa présentation précise (titre "Owner", "Utilisateur"/"Statut"/"Consulté
 * par", liste numérotée des accès). Même mécanisme de fond que "&access"
 * (le VRAI catalogue de permissions, utils/permissions/catalog.js), sur un
 * préfixe séparé ("=" au lieu de "&") et avec sa propre carte. "Statut" ne
 * dit jamais littéralement "Owner" : ce mot désignerait à tort le VRAI rang
 * propriétaire du bot (utils/accessStore.js), refusé plus haut dans la
 * commande.
 *
 * Lancement : node scripts/test-add-access.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "add-access-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const permStore = require("../utils/permissions/store");
const accessStore = require("../utils/accessStore");
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

function fakeGuild(id, { hasTarget = true } = {}) {
  const targetMember = { id: TARGET, user: { id: TARGET, tag: "cible#0001" } };
  return {
    id,
    members: { fetch: async (uid) => (hasTarget && uid === TARGET ? targetMember : null) },
  };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1", content, hasTarget = true } = {}) {
  const replies = [];
  const guild = fakeGuild(guildId, { hasTarget });
  return {
    content,
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
  console.log("Préfixe dédié \"=\" :");

  await cas("le préfixe par défaut est \"=\", distinct de \"&\" et \"!!\"", () => {
    const { owner, musicMod, protection } = getPrefixes("g-quelconque");
    assert.strictEqual(owner, "=");
    assert.notStrictEqual(owner, musicMod);
    assert.notStrictEqual(owner, protection);
  });

  console.log("\n\"=add\" — présentation dédiée (titre, statut, liste numérotée) :");

  await cas("sans panel.permissions.manage, silence", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "u1", content: `=add <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("titre \"Owner\", mention du membre, \"Consulté par\" l'auteur de la commande", async () => {
    permStore.grantToUser("g2", "staff-2", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g2", authorId: "staff-2", content: `=add <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("## Owner"), texte);
    assert.ok(texte.includes(`<@${TARGET}>`), texte);
    assert.ok(texte.includes("staff-2#0000"), texte);
  });

  await cas("jamais le mot \"Owner\" comme statut littéral du membre (rang réel distinct, non revendiqué à tort)", async () => {
    permStore.grantToUser("g2b", "staff-2b", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g2b", authorId: "staff-2b", content: `=add <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(!texte.includes("Statut** — ") || !texte.match(/Statut\*\* — [^\\]*Owner\\n/), texte);
    assert.ok(texte.includes("Aucun accès individuel"), texte);
  });

  await cas("sans accès accordé : \"Accès attribués — 0\" et liste vide honnête", async () => {
    permStore.grantToUser("g2c", "staff-2c", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g2c", authorId: "staff-2c", content: `=add <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("Accès attribués — 0"), texte);
    assert.ok(texte.includes("Aucun accès individuel pour l'instant"), texte);
  });

  await cas("un ID brut fonctionne aussi bien qu'une mention", async () => {
    permStore.grantToUser("g3", "staff-3", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g3", authorId: "staff-3", content: `=add ${TARGET}` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("sans argument, le message d'erreur rappelle SA PROPRE syntaxe (\"add @membre\", pas \"access @membre\")", async () => {
    permStore.grantToUser("g4", "staff-4", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g4", authorId: "staff-4", content: "=add" });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0]);
    assert.ok(texte.includes("add @membre"), texte);
    assert.ok(!texte.includes("access @membre"), texte);
  });

  await cas("membre introuvable sur le serveur : message clair, pas de plantage", async () => {
    permStore.grantToUser("g5", "staff-5", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g5", authorId: "staff-5", content: `=add <@${TARGET}>`, hasTarget: false });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("un membre déjà owner/sys (VRAI rang) est refusé — jamais ré-étiqueté par cette carte", async () => {
    // Cible DÉDIÉE, jamais réutilisée ailleurs dans ce fichier : "sys" est une
    // portée GLOBALE (utils/accessStore.js), pas par serveur — la marquer ici
    // la rendrait sys partout, y compris pour les tests suivants sur TARGET.
    const CIBLE_SYS = "111122223333444455";
    accessStore.add("sys", CIBLE_SYS);
    permStore.grantToUser("g5b", "staff-5b", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g5b", authorId: "staff-5b", content: `=add <@${CIBLE_SYS}>` });
    msg.guild.members.fetch = async (uid) => (uid === CIBLE_SYS ? { id: CIBLE_SYS, user: { id: CIBLE_SYS, tag: "sys#0001" } } : null);
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0]);
    assert.ok(texte.includes("propriétaire/rang sys"), texte);
    assert.ok(!texte.includes("## Owner"), texte);
  });

  console.log("\nInteractions dédiées (\"srv:ownercat\"/\"srv:ownerkey\") :");

  await cas("choisir une catégorie révèle ses clés, avec leur état accordé/non", async () => {
    permStore.grantToUser("g6", "staff-6", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:ownercat:${TARGET}`, { userId: "staff-6", guildId: "g6", values: ["moderation"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 1);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("srv:ownerkey"), texte);
  });

  await cas("choisir une clé non accordée l'accorde immédiatement, et l'affiche dans la liste numérotée", async () => {
    permStore.grantToUser("g7", "staff-7", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:ownerkey:${TARGET}:moderation`, {
      userId: "staff-7",
      guildId: "g7",
      values: ["moderation.kick"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(permStore.getUserGrants("g7", TARGET).includes("moderation.kick"));
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Accès attribués — 1"), texte);
    assert.ok(texte.includes("`01`"), texte);
  });

  await cas("choisir une clé DÉJÀ accordée la retire (bascule), \"Consulté par\" reflète qui clique MAINTENANT", async () => {
    permStore.grantToUser("g8", "staff-8", "panel.permissions.manage");
    permStore.grantToUser("g8", TARGET, "moderation.kick");
    const interaction = fakeInteraction(`srv:ownerkey:${TARGET}:moderation`, {
      userId: "staff-8-different",
      guildId: "g8",
      values: ["moderation.kick"],
    });
    permStore.grantToUser("g8", "staff-8-different", "panel.permissions.manage");
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(!permStore.getUserGrants("g8", TARGET).includes("moderation.kick"));
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("staff-8-different#0000"), texte);
  });

  await cas("après bascule, la catégorie reste ouverte (pas besoin de la rechoisir)", async () => {
    permStore.grantToUser("g9", "staff-9", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:ownerkey:${TARGET}:moderation`, {
      userId: "staff-9",
      guildId: "g9",
      values: ["moderation.ban"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("srv:ownerkey"), texte);
  });

  await cas("sans panel.permissions.manage, une bascule \"ownerkey\" est refusée", async () => {
    const interaction = fakeInteraction(`srv:ownerkey:${TARGET}:moderation`, {
      userId: "sans-perm",
      guildId: "g10",
      values: ["moderation.ban"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.strictEqual(interaction._replies.length, 1);
  });

  console.log("\nIsolation des préfixes :");

  await cas("un mot inconnu sur ce préfixe reste silencieux", async () => {
    const msg = fakeMessage({ guildId: "g11", authorId: "staff-11", content: "=nimportequoi" });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"&add\" (mauvais préfixe) ne déclenche jamais cette commande", async () => {
    permStore.grantToUser("g12", "staff-12", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g12", authorId: "staff-12", content: `&add <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"=owner\" (autre commande sur ce même préfixe) ne déclenche jamais \"=add\"", async () => {
    permStore.grantToUser("g12b", "staff-12b", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g12b", authorId: "staff-12b", content: `=owner <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("un message de bot est ignoré", async () => {
    permStore.grantToUser("g13", "staff-13", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g13", authorId: "staff-13", content: `=add <@${TARGET}>` });
    msg.author.bot = true;
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"&access\" garde sa propre présentation, jamais celle d'\"=add\"", async () => {
    permStore.grantToUser("g14", "staff-14", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g14", authorId: "staff-14", content: `&access <@${TARGET}>` });
    await serverAdmin.access(null, msg, [`<@${TARGET}>`]);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("Accès de"), texte);
    assert.ok(!texte.includes("## Owner"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
