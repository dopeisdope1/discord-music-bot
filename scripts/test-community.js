/**
 * Vérifie les fonctionnalités communautaires (Phase 3) : sondages
 * (utils/polls.js), giveaways (utils/giveawayStore.js), tickets
 * (utils/ticketStore.js), et le filtrage par permission de chaque commande.
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce process.
 *
 * Lancement : node scripts/test-community.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "community-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { parseQuoted } = require("../utils/polls");
const giveawayStore = require("../utils/giveawayStore");
const ticketStore = require("../utils/ticketStore");
const { can } = require("../utils/permissions/engine");
const { Collection } = require("discord.js");

let reussis = 0;
function cas(nom, fn) {
  try {
    fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("Sondages — analyse de la commande :");

cas('découpe "a" "b" "c" correctement', () => {
  assert.deepStrictEqual(parseQuoted('"Meilleur jeu ?" "Valorant" "LoL" "Autre"'), ["Meilleur jeu ?", "Valorant", "LoL", "Autre"]);
});

cas("ignore le texte hors guillemets", () => {
  assert.deepStrictEqual(parseQuoted('poll "Question" texte "Option"'), ["Question", "Option"]);
});

cas("chaîne vide -> aucune option", () => {
  assert.deepStrictEqual(parseQuoted(""), []);
});

console.log("\nGiveaways — stockage et tirage :");

cas("un giveaway créé est retrouvé, avec 0 participant au départ", () => {
  giveawayStore.create({ messageId: "m1", guildId: "g1", channelId: "c1", prize: "Nitro", endsAt: Date.now() + 60_000, hostId: "host-1" });
  const g = giveawayStore.get("m1");
  assert.strictEqual(g.prize, "Nitro");
  assert.deepStrictEqual(g.participants, []);
  assert.strictEqual(g.ended, false);
});

cas("participer bascule dans les deux sens (rejoindre puis quitter)", () => {
  const joined = giveawayStore.toggleParticipant("m1", "user-1");
  assert.strictEqual(joined, true);
  assert.deepStrictEqual(giveawayStore.get("m1").participants, ["user-1"]);
  const left = giveawayStore.toggleParticipant("m1", "user-1");
  assert.strictEqual(left, false);
  assert.deepStrictEqual(giveawayStore.get("m1").participants, []);
});

cas("un giveaway dont l'échéance est passée apparaît dans getExpiredActive", () => {
  giveawayStore.create({ messageId: "m2", guildId: "g1", channelId: "c1", prize: "Jeu", endsAt: Date.now() - 1000, hostId: "host-1" });
  const expired = giveawayStore.getExpiredActive();
  assert.ok(expired.some((g) => g.messageId === "m2"));
});

cas("un giveaway terminé (ended=true) n'apparaît plus dans getExpiredActive", () => {
  giveawayStore.markEnded("m2", "user-2");
  const expired = giveawayStore.getExpiredActive();
  assert.ok(!expired.some((g) => g.messageId === "m2"));
  assert.strictEqual(giveawayStore.get("m2").winnerId, "user-2");
});

cas("getLatestInChannel retrouve le giveaway le plus récent du salon", () => {
  giveawayStore.create({ messageId: "m3", guildId: "g1", channelId: "c1", prize: "Récent", endsAt: Date.now() + 120_000, hostId: "host-1" });
  const latest = giveawayStore.getLatestInChannel("c1");
  assert.strictEqual(latest.messageId, "m3");
});

console.log("\nTickets — configuration et suivi :");

cas("le rôle staff est configurable, null par défaut", () => {
  assert.strictEqual(ticketStore.getConfig("g1").staffRoleId, null);
  ticketStore.setStaffRole("g1", "staff-role-1");
  assert.strictEqual(ticketStore.getConfig("g1").staffRoleId, "staff-role-1");
});

cas("un ticket enregistré retrouve son propriétaire, puis plus rien après fermeture", () => {
  ticketStore.registerOpenTicket("ticket-chan-1", "g1", "requester-1");
  assert.deepStrictEqual(ticketStore.getTicketInfo("ticket-chan-1"), { guildId: "g1", ownerId: "requester-1" });
  ticketStore.unregisterTicket("ticket-chan-1");
  assert.strictEqual(ticketStore.getTicketInfo("ticket-chan-1"), null);
});

console.log("\nPermissions des nouvelles commandes :");

function fakeMember(id, guildId = "g1") {
  return { id, guild: { id: guildId }, roles: { cache: new Collection() } };
}

cas("aucune permission par défaut sur server.tickets.manage/polls.manage/giveaways.manage", () => {
  const member = fakeMember("random-user");
  assert.strictEqual(can(member, "server.tickets.manage"), false);
  assert.strictEqual(can(member, "server.polls.manage"), false);
  assert.strictEqual(can(member, "server.giveaways.manage"), false);
});

cas("le propriétaire du bot a accès à tout ça", () => {
  const member = fakeMember("owner-1");
  assert.strictEqual(can(member, "server.tickets.manage"), true);
  assert.strictEqual(can(member, "server.polls.manage"), true);
  assert.strictEqual(can(member, "server.giveaways.manage"), true);
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
