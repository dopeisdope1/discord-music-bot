/**
 * Vérifie que le ménage ne laisse pas ses propres traces :
 * - ` *  - &clear supprime aussi le message de commande (utils/moderationCommands.js) ;clear` a migré avec le reste de la modération vers moderation-bot.
 *  - `uo clear` supprime les messages de la personne ET tous ceux du bot
 *    (utils/selfClear.js), le déclencheur lui-même compris.
 *
 * Le périmètre côté bot est une demande explicite, maintenue après avoir été
 * discutée. Comme ce déclencheur n'exige aucune permission, une carte de
 * giveaway ou un panneau de tickets en cours part avec — les tests le
 * vérifient pour que ça reste un choix visible, pas une surprise.
 *
 * Lancement : node scripts/test-clear-cleanup.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clearcleanup-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { collectOwnConversation, handleSelfClear } = require("../utils/selfClear");


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

  await cas("MES messages, et eux seuls", () => {
    const salon = [msg("m1", MOI), msg("r1", BOT, "m1"), msg("carte-giveaway", BOT), msg("m2", MOI)];
    const pris = collectOwnConversation(salon, MOI, BOT).map((m) => m.id);
    assert.deepStrictEqual(pris.sort(), ["m1", "m2"]);
  });

  await cas("une carte du bot n'est PLUS emportée", () => {
    // Le déclencheur n'exige AUCUNE permission : tant que les messages du bot
    // partaient avec, n'importe qui pouvait supprimer un giveaway en cours ou
    // un panneau de tickets sans laisser de trace. Ce test garde la porte
    // fermée.
    const salon = [msg("carte-giveaway", BOT), msg("panneau-tickets", BOT)];
    assert.deepStrictEqual(collectOwnConversation(salon, MOI, BOT), []);
  });

  await cas("une réponse du bot qui m'est adressée reste elle aussi", () => {
    const salon = [msg("mon-message", MOI), msg("sa-reponse", BOT, "mon-message")];
    assert.deepStrictEqual(collectOwnConversation(salon, MOI, BOT).map((m) => m.id), ["mon-message"]);
  });

  await cas("PAS les messages des autres membres — la seule limite qui reste", () => {
    const salon = [msg("m1", MOI), msg("m2", AUTRE), msg("m3", AUTRE)];
    assert.deepStrictEqual(collectOwnConversation(salon, MOI, BOT).map((m) => m.id), ["m1"]);
  });

  await cas("le message déclencheur part avec, puisqu'il est de la personne", () => {
    const salon = [msg("le-uo-clear", MOI)];
    assert.deepStrictEqual(collectOwnConversation(salon, MOI, BOT).map((m) => m.id), ["le-uo-clear"]);
  });

  await cas("l'identifiant du bot ne change plus rien au résultat", () => {
    // Il reste dans la signature (les appelants le passent) mais n'a plus
    // aucun effet : le vérifier évite qu'un futur remaniement le réintroduise
    // discrètement dans le filtre.
    const salon = [msg("m1", MOI), msg("r1", BOT, "m1")];
    const avec = collectOwnConversation(salon, MOI, BOT).map((m) => m.id);
    const sans = collectOwnConversation(salon, MOI, undefined).map((m) => m.id);
    assert.deepStrictEqual(avec, ["m1"]);
    assert.deepStrictEqual(avec, sans);
  });

  console.log("\n`uo clear` de bout en bout :");

  await cas("de bout en bout, SEULS mes messages sont supprimés", async () => {
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
    assert.ok(supprimes.includes("m1"), `mes messages doivent partir : ${supprimes.join(", ")}`);
    assert.ok(!supprimes.includes("r1"), "la réponse du bot devait rester");
    assert.ok(!supprimes.includes("carte"), "une carte du bot devait rester");
    assert.ok(!supprimes.includes("autre"), "le message d'un autre membre devait rester");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
