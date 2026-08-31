/**
 * Vérifie que le ménage ne laisse pas ses propres traces :
 *  - &clear supprime aussi le message de commande (utils/moderationCommands.js) ;
 *  - `uo clear` supprime aussi les réponses que le bot a faites à la personne
 *    (utils/selfClear.js), mais RIEN d'autre du bot.
 *
 * Ce dernier point est le plus important : le déclencheur est ouvert à tout le
 * monde, sans permission. S'il effaçait tous les messages du bot, n'importe qui
 * pourrait supprimer une carte de giveaway ou un panneau de tickets.
 *
 * Lancement : node scripts/test-clear-cleanup.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clearcleanup-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const permStore = require("../utils/permissions/store");
const { collectOwnConversation, handleSelfClear } = require("../utils/selfClear");
const { moderationHandlers } = require("../utils/moderationCommands");

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

const BOT = "bot-1";
const MOI = "moi";
const AUTRE = "quelquun-dautre";
// &clear n'accepte qu'un identifiant Discord (15 à 25 chiffres) comme cible.
const CIBLE = "123456789012345678";
const MOD = "987654321098765432";

const msg = (id, authorId, referenceId = null) => ({
  id,
  author: { id: authorId },
  reference: referenceId ? { messageId: referenceId } : null,
  createdTimestamp: Date.now(),
  delete: async () => {},
});

(async () => {
  console.log("`uo clear` — quels messages sont emportés :");

  await cas("mes messages et les réponses du bot qui me sont adressées", () => {
    const salon = [msg("m1", MOI), msg("r1", BOT, "m1"), msg("m2", MOI), msg("r2", BOT, "m2")];
    const pris = collectOwnConversation(salon, MOI, BOT).map((m) => m.id);
    assert.deepStrictEqual(pris.sort(), ["m1", "m2", "r1", "r2"]);
  });

  await cas("PAS les messages du bot qui ne répondent à personne", () => {
    // Une carte de giveaway, un panneau de tickets, le lecteur de musique :
    // postés sans référence, ils ne doivent jamais partir.
    const salon = [msg("m1", MOI), msg("carte-giveaway", BOT), msg("panneau-tickets", BOT)];
    const pris = collectOwnConversation(salon, MOI, BOT).map((m) => m.id);
    assert.deepStrictEqual(pris, ["m1"], "seuls mes messages devaient partir");
  });

  await cas("PAS les réponses du bot adressées à quelqu'un d'autre", () => {
    const salon = [msg("m1", MOI), msg("son-message", AUTRE), msg("sa-reponse", BOT, "son-message")];
    const pris = collectOwnConversation(salon, MOI, BOT).map((m) => m.id);
    assert.deepStrictEqual(pris, ["m1"]);
  });

  await cas("PAS les messages des autres membres", () => {
    const salon = [msg("m1", MOI), msg("m2", AUTRE)];
    assert.deepStrictEqual(collectOwnConversation(salon, MOI, BOT).map((m) => m.id), ["m1"]);
  });

  await cas("sans bot identifiable, on se limite à mes messages", () => {
    const salon = [msg("m1", MOI), msg("r1", BOT, "m1")];
    assert.deepStrictEqual(collectOwnConversation(salon, MOI, undefined).map((m) => m.id), ["m1"]);
  });

  console.log("\n`uo clear` de bout en bout :");

  await cas("le déclencheur emporte bien la conversation complète", async () => {
    const salon = [msg("m1", MOI), msg("r1", BOT, "m1"), msg("carte", BOT), msg("autre", AUTRE)];
    const supprimes = [];
    const channel = {
      id: "c1",
      messages: { fetch: async () => new Collection(salon.map((m) => [m.id, m])) },
      bulkDelete: async (liste) => {
        for (const m of liste) supprimes.push(m.id);
        return new Collection(liste.map((m) => [m.id, m]));
      },
      send: async () => ({ edit: async () => {}, delete: async () => {} }),
    };
    const declencheur = {
      content: "uo clear",
      author: { id: MOI, bot: false },
      guild: { id: "g1" },
      channel,
    };
    await handleSelfClear({ user: { id: BOT } }, declencheur);
    assert.ok(supprimes.includes("m1") && supprimes.includes("r1"), supprimes.join(", "));
    assert.ok(!supprimes.includes("carte"), "la carte du bot devait rester");
    assert.ok(!supprimes.includes("autre"), "le message d'un autre membre devait rester");
  });

  console.log("\n&clear — la commande elle-même :");

  permStore.setRoleGrants("g1", "role-mod", ["moderation.clear"]);

  await cas("le message de commande est supprimé après le nettoyage", async () => {
    let commandeSupprimee = false;
    const cibles = [msg("c1", CIBLE), msg("c2", CIBLE)];
    const channel = {
      id: "c1",
      messages: { fetch: async () => new Collection(cibles.map((m) => [m.id, m])) },
      bulkDelete: async (liste) => new Collection(liste.map((m) => [m.id, m])),
      send: async () => ({ delete: async () => {} }),
    };
    const commande = {
      content: `&clear <@${CIBLE}>`,
      author: { id: MOD, tag: "mod#0001" },
      member: {
        id: MOD,
        guild: { id: "g1" },
        roles: { cache: new Collection([["role-mod", { id: "role-mod" }]]) },
        permissions: new PermissionsBitField(),
      },
      guild: {
        id: "g1",
        members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All) } },
      },
      channel,
      mentions: { users: new Collection(), members: new Collection() },
      reply: async () => ({}),
      delete: async () => {
        commandeSupprimee = true;
      },
    };
    await moderationHandlers.clear({ user: { id: BOT } }, commande, [`<@${CIBLE}>`]);
    assert.ok(commandeSupprimee, "&clear doit effacer sa propre invocation");
  });

  await cas("une suppression déjà faite ne fait pas planter la commande", async () => {
    // Cas réel : on nettoie ses PROPRES messages, donc l'invocation est déjà
    // partie avec le lot quand on essaie de la supprimer.
    const cibles = [msg("x1", MOD)];
    const channel = {
      id: "c1",
      messages: { fetch: async () => new Collection(cibles.map((m) => [m.id, m])) },
      bulkDelete: async (liste) => new Collection(liste.map((m) => [m.id, m])),
      send: async () => ({ delete: async () => {} }),
    };
    const commande = {
      content: `&clear <@${MOD}>`,
      author: { id: MOD, tag: "mod#0001" },
      member: {
        id: MOD,
        guild: { id: "g1" },
        roles: { cache: new Collection([["role-mod", { id: "role-mod" }]]) },
        permissions: new PermissionsBitField(),
      },
      guild: { id: "g1", members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All) } } },
      channel,
      mentions: { users: new Collection(), members: new Collection() },
      reply: async () => ({}),
      delete: async () => {
        throw new Error("Unknown Message");
      },
    };
    await moderationHandlers.clear({ user: { id: BOT } }, commande, [`<@${MOD}>`]);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
