/**
 * Vérifie que le ménage ne laisse pas ses propres traces :
 *  - &clear supprime aussi le message de commande (utils/moderationCommands.js) ;
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

  console.log("\n&clear sans cible — le CrowBot garde la parole :");

  const clearSansCible = async (args) => {
    const reponses = [];
    const commande = {
      content: `&clear ${args.join(" ")}`,
      author: { id: MOD, tag: "mod#0001" },
      member: {
        id: MOD,
        guild: { id: "g1" },
        roles: { cache: new Collection([["role-mod", { id: "role-mod" }]]) },
        permissions: new PermissionsBitField(),
      },
      guild: { id: "g1", members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All) } } },
      channel: {
        id: "c1",
        messages: { fetch: async () => new Collection() },
        bulkDelete: async () => new Collection(),
        send: async () => ({ delete: async () => {} }),
      },
      mentions: { users: new Collection(), members: new Collection() },
      reply: async (p) => {
        reponses.push(p);
        return {};
      },
      delete: async () => {},
    };
    await moderationHandlers.clear({ user: { id: BOT } }, commande, args);
    return reponses;
  };

  await cas("`&clear` seul ne répond rien", async () => {
    assert.deepStrictEqual(await clearSansCible([]), []);
  });

  await cas("`&clear 50` ne répond rien — c'est la syntaxe du CrowBot", async () => {
    // Le préfixe "&" est partagé : expliquer la syntaxe reviendrait à couper
    // la parole à l'autre bot sur sa propre commande.
    assert.deepStrictEqual(await clearSansCible(["50"]), []);
  });

  await cas("`&clear mot` ne répond rien non plus", async () => {
    assert.deepStrictEqual(await clearSansCible(["nimportequoi"]), []);
  });

  await cas("mais `&clear <@id>` agit bien", async () => {
    const reponses = await clearSansCible([`<@${CIBLE}>`]);
    assert.strictEqual(reponses.length, 1, "une cible valide doit produire une réponse");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
