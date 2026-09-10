/**
 * Vérifie la gestion d'un ticket déjà ouvert (utils/tickets.js) :
 * &ticket claim/add/remove/rename/close — ajoutées pour combler un vrai trou
 * fonctionnel repéré lors d'un audit du catalogue de commandes (&help
 * n'annonçait "ticket setup"/"ticket settings" que pour ouvrir/configurer,
 * sans aucun moyen de gérer un ticket une fois ouvert). Le bouton "Fermer"
 * (utils/tickets.js::handleTicketButton) et la commande `&ticket close`
 * doivent accorder EXACTEMENT le même droit, d'où le test dédié plus bas.
 *
 * Lancement : node scripts/test-ticket-management.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-mgmt-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const ticketStore = require("../utils/ticketStore");
const permissionsStore = require("../utils/permissions/store");
const { claimTicket, addTicketMember, removeTicketMember, renameTicket, closeTicketCommand } = require("../utils/tickets");
const { handleMusicTextCommand } = require("../utils/musicCommands");

// "staff-1" représente un membre du staff avec le droit accordé normalement
// (&set perm), PAS le propriétaire du bot — pour vérifier le vrai chemin de
// permission, pas seulement le contournement "isOwner".
permissionsStore.grantToUser("g1", "staff-1", "server.tickets.manage");

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

/** Fausse guild dont members.fetch résout depuis une table fournie, comme le vrai cache Discord après un fetch. */
function fakeGuild(id, membresParId = {}) {
  return {
    id,
    members: { fetch: async (uid) => membresParId[uid] || null },
  };
}

function fakeChannel(id, name) {
  const overwrites = new Map();
  const chan = {
    id,
    name,
    delete: async () => {},
    permissionOverwrites: {
      edit: async (uid) => overwrites.set(uid, true),
      delete: async (uid) => overwrites.delete(uid),
    },
    _overwrites: overwrites,
  };
  chan.setName = async (n) => {
    chan.name = n;
    return chan;
  };
  return chan;
}

function fakeMember(id, roleIds = []) {
  const roles = new Collection();
  for (const r of roleIds) roles.set(r, { id: r });
  return { id, guild: { id: "g1" }, roles: { cache: roles } };
}

function fakeMessage({ author, member, guild, channel, mentionedMember = null }) {
  const replies = [];
  return {
    author,
    member,
    guild,
    channel,
    mentions: {
      members: { first: () => mentionedMember },
    },
    reply: async (p) => {
      replies.push(p);
      return { id: "msg-1" };
    },
    _replies: replies,
  };
}

const embedText = (reply) => reply?.embeds?.[0]?.data?.description || "";

/** Message complet (content + mentions en Collection) pour passer par le VRAI routage de &-commandes, pas juste le handler. */
function fakeDispatchMessage({ content, author, member, guild, channel, mentionedMember = null }) {
  const replies = [];
  const members = new Collection();
  if (mentionedMember) members.set(mentionedMember.id, mentionedMember);
  return {
    content,
    author,
    member,
    guild,
    channel,
    mentions: { users: new Collection(), members, roles: new Collection(), channels: new Collection(), everyone: false },
    reply: async (p) => {
      replies.push(p);
      return { id: "msg-1" };
    },
    _replies: replies,
  };
}

(async () => {
  console.log("&ticket claim/add/remove/rename : n'agissent que dans un ticket suivi :");

  await cas("hors d'un ticket, chaque commande refuse avec un message clair, sans rien modifier", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("not-a-ticket", "général");
    const staff = fakeMember("staff-1");
    const message = fakeMessage({ author: { id: "staff-1", tag: "staff#0001" }, member: staff, guild, channel });

    await claimTicket({}, message);
    assert.ok(embedText(message._replies[0]).includes("ticket ouvert"));
    assert.strictEqual(ticketStore.getTicketInfo("not-a-ticket"), null);
  });

  console.log("\n&ticket claim :");

  await cas("mémorise qui a pris le ticket en charge", async () => {
    ticketStore.registerOpenTicket("t1", "g1", "requester-1");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t1", "ticket-requester");
    const staff = fakeMember("staff-1");
    const message = fakeMessage({ author: { id: "staff-1", tag: "staff#0001" }, member: staff, guild, channel });

    await claimTicket({}, message);
    assert.strictEqual(ticketStore.getTicketInfo("t1").claimedBy, "staff-1");
    assert.ok(embedText(message._replies[0]).includes("staff-1"));
  });

  console.log("\n&ticket add / &ticket remove :");

  await cas("add donne l'accès au salon, remove le retire", async () => {
    const guild = fakeGuild("g1", { "helper-1": { id: "helper-1" } });
    const channel = fakeChannel("t1", "ticket-requester");
    const staff = fakeMember("staff-1");
    const helper = { id: "helper-1" };

    const addMsg = fakeMessage({ author: { id: "staff-1", tag: "staff#0001" }, member: staff, guild, channel, mentionedMember: helper });
    await addTicketMember({}, addMsg, []);
    assert.ok(channel._overwrites.has("helper-1"));
    assert.ok(embedText(addMsg._replies[0]).includes("accès à ce ticket"));

    const delMsg = fakeMessage({ author: { id: "staff-1", tag: "staff#0001" }, member: staff, guild, channel, mentionedMember: helper });
    await removeTicketMember({}, delMsg, []);
    assert.ok(!channel._overwrites.has("helper-1"));
  });

  await cas("impossible de retirer le créateur de son propre ticket", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t1", "ticket-requester");
    const staff = fakeMember("staff-1");
    const owner = { id: "requester-1" };

    const message = fakeMessage({ author: { id: "staff-1", tag: "staff#0001" }, member: staff, guild, channel, mentionedMember: owner });
    await removeTicketMember({}, message, []);
    assert.ok(embedText(message._replies[0]).includes("créateur"));
  });

  await cas("sans membre indiqué, message d'erreur explicite et aucun appel Discord", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t1", "ticket-requester");
    const staff = fakeMember("staff-1");
    const message = fakeMessage({ author: { id: "staff-1", tag: "staff#0001" }, member: staff, guild, channel });

    await addTicketMember({}, message, []);
    assert.ok(embedText(message._replies[0]).includes("Indique un membre"));
  });

  console.log("\n&ticket rename :");

  await cas("renomme le salon du ticket courant", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t1", "ticket-requester");
    const staff = fakeMember("staff-1");
    const message = fakeMessage({ author: { id: "staff-1", tag: "staff#0001" }, member: staff, guild, channel });

    await renameTicket({}, message, ["support", "urgent"]);
    assert.strictEqual(channel.name, "support urgent");
  });

  console.log('\n&ticket close — même droit que le bouton "Fermer" :');

  await cas("le propriétaire du bot peut toujours fermer", async () => {
    ticketStore.registerOpenTicket("t2", "g1", "requester-2");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t2", "ticket-2");
    const message = fakeMessage({ author: { id: "owner-1", tag: "owner#0001" }, member: fakeMember("owner-1"), guild, channel });

    await closeTicketCommand({}, message, []);
    assert.strictEqual(ticketStore.getTicketInfo("t2"), null);
    assert.ok(embedText(message._replies[0]).includes("fermé"));
  });

  await cas("sans rôle de fermeture, sans permission, sans être le demandeur : refusé, le ticket reste ouvert", async () => {
    ticketStore.registerOpenTicket("t3", "g1", "requester-3");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t3", "ticket-3");
    const intrus = fakeMember("random-user");
    const message = fakeMessage({ author: { id: "random-user", tag: "random#0001" }, member: intrus, guild, channel });

    await closeTicketCommand({}, message, []);
    assert.ok(ticketStore.getTicketInfo("t3") !== null);
    assert.ok(embedText(message._replies[0]).includes("staff"));
  });

  await cas("le demandeur peut fermer son propre ticket (ownerCanClose par défaut)", async () => {
    ticketStore.registerOpenTicket("t4", "g1", "requester-4");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t4", "ticket-4");
    const demandeur = fakeMember("requester-4");
    const message = fakeMessage({ author: { id: "requester-4", tag: "requester#0001" }, member: demandeur, guild, channel });

    await closeTicketCommand({}, message, ["problème résolu"]);
    assert.strictEqual(ticketStore.getTicketInfo("t4"), null);
  });

  await cas("ownerCanClose=false retire ce droit au demandeur", async () => {
    ticketStore.registerOpenTicket("t5", "g1", "requester-5");
    ticketStore.setConfig("g1", { ownerCanClose: false });
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t5", "ticket-5");
    const demandeur = fakeMember("requester-5");
    const message = fakeMessage({ author: { id: "requester-5", tag: "requester#0001" }, member: demandeur, guild, channel });

    await closeTicketCommand({}, message, []);
    assert.ok(ticketStore.getTicketInfo("t5") !== null);
    assert.ok(embedText(message._replies[0]).includes("staff peut fermer"));
    ticketStore.setConfig("g1", { ownerCanClose: true });
  });

  console.log('\nRaccourcis sans "ticket" devant (&close/&claim/&add/&remove/&rename) — demande explicite pour ne pas avoir à retaper "ticket" à chaque fois, ' +
    "MAIS seulement dans un salon de ticket suivi, jamais ailleurs :");

  await cas("&close ferme le ticket courant, sans écrire \"ticket\"", async () => {
    ticketStore.registerOpenTicket("t6", "g1", "requester-6");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t6", "ticket-6");
    const message = fakeDispatchMessage({ content: "&close", author: { id: "staff-1", tag: "staff#0001" }, member: fakeMember("staff-1"), guild, channel });

    await handleMusicTextCommand({}, message);
    assert.strictEqual(ticketStore.getTicketInfo("t6"), null);
    assert.ok(embedText(message._replies[0]).includes("fermé"));
  });

  await cas("&close tapé hors d'un ticket ne fait RIEN (silence, comme une commande inconnue sur ce préfixe)", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("chan-normal", "général");
    const message = fakeDispatchMessage({ content: "&close", author: { id: "staff-1", tag: "staff#0001" }, member: fakeMember("staff-1"), guild, channel });

    await handleMusicTextCommand({}, message);
    assert.strictEqual(message._replies.length, 0);
  });

  await cas("&claim prend en charge le ticket courant", async () => {
    ticketStore.registerOpenTicket("t7", "g1", "requester-7");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t7", "ticket-7");
    const message = fakeDispatchMessage({ content: "&claim", author: { id: "staff-1", tag: "staff#0001" }, member: fakeMember("staff-1"), guild, channel });

    await handleMusicTextCommand({}, message);
    assert.strictEqual(ticketStore.getTicketInfo("t7").claimedBy, "staff-1");
  });

  await cas("&claim tapé hors d'un ticket ne fait rien", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("chan-normal", "général");
    const message = fakeDispatchMessage({ content: "&claim", author: { id: "staff-1", tag: "staff#0001" }, member: fakeMember("staff-1"), guild, channel });

    await handleMusicTextCommand({}, message);
    assert.strictEqual(message._replies.length, 0);
  });

  await cas("&add <mention> ajoute bien le membre, dans un ticket", async () => {
    ticketStore.registerOpenTicket("t8", "g1", "requester-8");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t8", "ticket-8");
    const helper = { id: "helper-1" };
    const message = fakeDispatchMessage({
      content: "&add <@helper-1>",
      author: { id: "staff-1", tag: "staff#0001" },
      member: fakeMember("staff-1"),
      guild,
      channel,
      mentionedMember: helper,
    });

    await handleMusicTextCommand({}, message);
    assert.ok(channel._overwrites.has("helper-1"));
  });

  await cas("&add tapé hors d'un ticket ne fait rien (même avec une cible)", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("chan-normal", "général");
    const helper = { id: "helper-1" };
    const message = fakeDispatchMessage({
      content: "&add <@helper-1>",
      author: { id: "staff-1", tag: "staff#0001" },
      member: fakeMember("staff-1"),
      guild,
      channel,
      mentionedMember: helper,
    });

    await handleMusicTextCommand({}, message);
    assert.ok(!channel._overwrites.has("helper-1"));
  });

  await cas("&rename renomme bien le ticket courant", async () => {
    ticketStore.registerOpenTicket("t9", "g1", "requester-9");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t9", "ticket-9");
    const message = fakeDispatchMessage({ content: "&rename support prioritaire", author: { id: "staff-1", tag: "staff#0001" }, member: fakeMember("staff-1"), guild, channel });

    await handleMusicTextCommand({}, message);
    assert.strictEqual(channel.name, "support prioritaire");
  });

  await cas("&remove garde son ANCIEN sens (remove activity) hors d'un ticket — pas de régression", async () => {
    const guild = fakeGuild("g1");
    const channel = fakeChannel("chan-normal", "général");
    // owner-1 : contourne la permission "sys" exigée par "remove activity", pour isoler ce qu'on teste ici.
    const message = fakeDispatchMessage({ content: "&remove", author: { id: "owner-1", tag: "owner#0001" }, member: fakeMember("owner-1"), guild, channel });

    await handleMusicTextCommand({}, message);
    // "&remove" seul (sans cible) déclenche le rappel de syntaxe habituel (une image, pas un
    // embed texte comme &ticket répond) : la preuve qu'on est tombé dans l'ANCIEN chemin
    // (remove activity / remove <membre>, en carte de rappel), jamais dans la gestion de ticket
    // — qui, elle, n'a jamais de raison de s'activer hors d'un ticket suivi.
    assert.strictEqual(message._replies.length, 1);
    assert.ok(!message._replies[0].embeds, "une réponse de gestion de ticket a toujours un embed (buildStatusEmbed)");
  });

  await cas("&remove <mention> retire bien le membre, DANS un ticket", async () => {
    ticketStore.registerOpenTicket("t10", "g1", "requester-10");
    const guild = fakeGuild("g1");
    const channel = fakeChannel("t10", "ticket-10");
    channel._overwrites.set("helper-1", true);
    const helper = { id: "helper-1" };
    const message = fakeDispatchMessage({
      content: "&remove <@helper-1>",
      author: { id: "staff-1", tag: "staff#0001" },
      member: fakeMember("staff-1"),
      guild,
      channel,
      mentionedMember: helper,
    });

    await handleMusicTextCommand({}, message);
    assert.ok(!channel._overwrites.has("helper-1"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
