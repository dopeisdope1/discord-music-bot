/**
 * Vérifie "!!setclear" (utils/setClearCommand.js) : configure PAR SERVEUR les
 * noms qui déclenchent le nettoyage automatique ("<nom> clear", voir
 * utils/selfClear.js) et le délai entre deux usages — remplace l'ancien
 * "uo clear" fixé en dur et son quota fixe de 2 usages/25min.
 *
 *  - Permission dédiée du catalogue existant (&panel > Permissions) :
 *    "server.selfclear.manage", ou administrateur Discord.
 *  - Le panneau garde un BROUILLON en mémoire tant que "Confirmer" n'a pas
 *    été cliqué — utils/selfClearStore.js (sur disque) n'est modifié qu'à ce
 *    moment-là.
 *  - "Réinitialiser" revient à ce qui est ENREGISTRÉ (annule les changements
 *    non confirmés), "Annuler" ferme l'édition.
 *  - Une fois confirmé, utils/selfClear.js utilise réellement la config
 *    (bout en bout).
 *
 * Lancement : node scripts/test-setclear.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "setclear-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { handleSetClearTextCommand, handleSetClearInteraction } = require("../utils/setClearCommand");
const selfClearStore = require("../utils/selfClearStore");
const { handleSelfClear } = require("../utils/selfClear");
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

// ---- Fixtures ----

function fakeChannel(id) {
  const envois = [];
  return {
    id,
    send: async (payload) => {
      const msg = { id: `msg-${envois.length + 1}` };
      envois.push({ payload, msg });
      return msg;
    },
    _envois: envois,
  };
}

function texteDu(conteneur) {
  return conteneur.components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
}

function fakeMessage({ guildId, authorId, content, channel, isAdmin = false, permissionKey }) {
  if (permissionKey) permStore.grantToUser(guildId, authorId, permissionKey);
  const replies = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guild: { id: guildId },
    channel: channel || fakeChannel("chan-defaut"),
    member: {
      id: authorId,
      guild: { id: guildId },
      roles: { cache: new Collection() },
      permissions: { has: () => isAdmin },
    },
    reply: async (p) => replies.push(p),
    _replies: replies,
  };
}

function fakeInteraction({ guildId, customId, userId, values, isAdmin = false, permissionKey }) {
  if (permissionKey) permStore.grantToUser(guildId, userId, permissionKey);
  const replies = [];
  const updates = [];
  const modals = [];
  return {
    customId,
    user: { id: userId, tag: `${userId}#0001` },
    guild: { id: guildId },
    member: {
      id: userId,
      guild: { id: guildId },
      roles: { cache: new Collection() },
      permissions: { has: () => isAdmin },
    },
    values,
    reply: async (p) => replies.push(p),
    update: async (p) => updates.push(p),
    showModal: async (m) => modals.push(m),
    _replies: replies,
    _updates: updates,
    _modals: modals,
  };
}

function fakeModalSubmit({ guildId, action, userId, valeur }) {
  const i = fakeInteraction({ guildId, customId: `setclear:${action}`, userId });
  i.fields = { getTextInputValue: (champ) => (champ === "valeur" ? valeur : null) };
  return i;
}

(async () => {
  console.log("Mot-clé et préfixe :");

  await cas('un mot inconnu après "!!" reste silencieux', async () => {
    const channel = fakeChannel("c1");
    await handleSetClearTextCommand(null, fakeMessage({ guildId: "g-mot", authorId: "u1", content: "!!nimportequoi", channel }));
    assert.strictEqual(channel._envois.length, 0);
  });

  await cas('le préfixe "&" n\'est pas concerné', async () => {
    const channel = fakeChannel("c1");
    await handleSetClearTextCommand(null, fakeMessage({ guildId: "g-prefixe", authorId: "u1", content: "&setclear", channel }));
    assert.strictEqual(channel._envois.length, 0);
  });

  console.log("\n!!setclear — permission et panneau initial :");

  await cas("sans server.selfclear.manage ni admin, refusé", async () => {
    const channel = fakeChannel("c1");
    const msg = fakeMessage({ guildId: "g-non", authorId: "u-sans", content: "!!setclear", channel });
    await handleSetClearTextCommand(null, msg);
    assert.strictEqual(channel._envois.length, 0);
    assert.ok(msg._replies.length > 0, "un message d'erreur doit être renvoyé");
  });

  await cas("un administrateur Discord peut ouvrir le panneau (sans la clé dédiée)", async () => {
    const channel = fakeChannel("c1");
    const msg = fakeMessage({ guildId: "g-admin", authorId: "u-admin", content: "!!setclear", channel, isAdmin: true });
    await handleSetClearTextCommand(null, msg);
    assert.strictEqual(channel._envois.length, 1);
  });

  await cas("le panneau affiche le nom par défaut (uo) et le cooldown par défaut (15min)", async () => {
    const channel = fakeChannel("c1");
    const msg = fakeMessage({ guildId: "g-defaut", authorId: "u-admin", content: "!!setclear", channel, permissionKey: "server.selfclear.manage" });
    await handleSetClearTextCommand(null, msg);
    const conteneur = channel._envois[0].payload.components[0].toJSON();
    const texte = texteDu(conteneur);
    assert.ok(texte.includes("uo"), texte);
    assert.ok(texte.includes("15min"), texte);
    const menu = conteneur.components.find((c) => c.type === 1 && c.components[0]?.type === 3);
    assert.deepStrictEqual(
      menu.components[0].options.map((o) => o.value),
      ["noms", "cooldown"]
    );
    const boutons = conteneur.components.find((c) => c.type === 1 && c.components[0]?.type === 2);
    assert.deepStrictEqual(boutons.components.map((b) => b.label), ["Confirmer", "Réinitialiser", "Annuler"]);
  });

  console.log("\nÉdition — choix du champ, ouverture de la modale :");

  await cas("choisir « Noms autorisés » ouvre une modale préremplie avec les noms actuels", async () => {
    const guildId = "g-modal-noms";
    const i = fakeInteraction({ guildId, customId: "setclear:choix", userId: "u1", values: ["noms"], permissionKey: "server.selfclear.manage" });
    await handleSetClearInteraction(i);
    assert.strictEqual(i._modals.length, 1);
    const champ = i._modals[0].components[0].components[0];
    assert.strictEqual(champ.data.value, "uo");
  });

  await cas("choisir « Temps entre chaque clear » ouvre une modale préremplie avec le cooldown actuel", async () => {
    const guildId = "g-modal-cd";
    const i = fakeInteraction({ guildId, customId: "setclear:choix", userId: "u1", values: ["cooldown"], permissionKey: "server.selfclear.manage" });
    await handleSetClearInteraction(i);
    assert.strictEqual(i._modals.length, 1);
    const champ = i._modals[0].components[0].components[0];
    assert.strictEqual(champ.data.value, "15min");
  });

  await cas("sans la permission, aucune modale ne s'ouvre", async () => {
    const i = fakeInteraction({ guildId: "g-refus", customId: "setclear:choix", userId: "u-sans", values: ["noms"] });
    await handleSetClearInteraction(i);
    assert.strictEqual(i._modals.length, 0);
    assert.ok(i._replies.length > 0);
  });

  console.log("\nSoumission des modales — brouillon, pas encore enregistré :");

  await cas("soumettre la modale « noms » met à jour la CARTE mais pas encore le store", async () => {
    const guildId = "g-brouillon-noms";
    // Ouvre d'abord le panneau (crée le brouillon initial).
    await handleSetClearTextCommand(null, fakeMessage({ guildId, authorId: "u1", content: "!!setclear", permissionKey: "server.selfclear.manage" }));
    const soumission = fakeModalSubmit({ guildId, action: "noms", userId: "u1", valeur: "kash, oan, zarok" });
    await handleSetClearInteraction(soumission);
    assert.strictEqual(soumission._updates.length, 1);
    const texte = texteDu(soumission._updates[0].components[0].toJSON());
    assert.ok(texte.includes("kash") && texte.includes("oan") && texte.includes("zarok"), texte);
    assert.deepStrictEqual(selfClearStore.getConfig(guildId).names, ["uo"], "le store ne doit pas bouger avant Confirmer");
  });

  await cas("une durée invalide dans la modale « cooldown » est refusée proprement", async () => {
    const guildId = "g-cooldown-invalide";
    await handleSetClearTextCommand(null, fakeMessage({ guildId, authorId: "u1", content: "!!setclear", permissionKey: "server.selfclear.manage" }));
    const soumission = fakeModalSubmit({ guildId, action: "cooldown", userId: "u1", valeur: "pasunedureee" });
    await handleSetClearInteraction(soumission);
    assert.strictEqual(soumission._updates.length, 0);
    assert.ok(soumission._replies.length > 0);
  });

  console.log("\nConfirmer / Réinitialiser / Annuler :");

  await cas("Confirmer écrit bien le brouillon dans le store", async () => {
    const guildId = "g-confirmer";
    await handleSetClearTextCommand(null, fakeMessage({ guildId, authorId: "u1", content: "!!setclear", permissionKey: "server.selfclear.manage" }));
    await handleSetClearInteraction(fakeModalSubmit({ guildId, action: "noms", userId: "u1", valeur: "kash" }));
    await handleSetClearInteraction(fakeModalSubmit({ guildId, action: "cooldown", userId: "u1", valeur: "30m" }));
    await handleSetClearInteraction(fakeInteraction({ guildId, customId: "setclear:confirmer", userId: "u1", permissionKey: "server.selfclear.manage" }));

    const config = selfClearStore.getConfig(guildId);
    assert.deepStrictEqual(config.names, ["kash"]);
    assert.strictEqual(config.cooldownMs, 30 * 60_000);
  });

  await cas("Réinitialiser revient au dernier état ENREGISTRÉ, pas aux valeurs d'usine", async () => {
    const guildId = "g-reinit";
    await handleSetClearTextCommand(null, fakeMessage({ guildId, authorId: "u1", content: "!!setclear", permissionKey: "server.selfclear.manage" }));
    await handleSetClearInteraction(fakeModalSubmit({ guildId, action: "noms", userId: "u1", valeur: "kash" }));
    await handleSetClearInteraction(fakeInteraction({ guildId, customId: "setclear:confirmer", userId: "u1", permissionKey: "server.selfclear.manage" }));

    // Nouvelle modification NON confirmée.
    await handleSetClearInteraction(fakeModalSubmit({ guildId, action: "noms", userId: "u1", valeur: "autrechose" }));
    assert.deepStrictEqual(selfClearStore.getConfig(guildId).names, ["kash"], "le store ne doit toujours pas avoir bougé");

    const reinit = fakeInteraction({ guildId, customId: "setclear:reinitialiser", userId: "u1", permissionKey: "server.selfclear.manage" });
    await handleSetClearInteraction(reinit);
    const texte = texteDu(reinit._updates[0].components[0].toJSON());
    assert.ok(texte.includes("kash"), texte);
    assert.ok(!texte.includes("autrechose"), texte);
  });

  await cas("Annuler ferme l'édition sans toucher au store", async () => {
    const guildId = "g-annuler";
    selfClearStore.setNames(guildId, ["referencenontouchee"]);
    await handleSetClearTextCommand(null, fakeMessage({ guildId, authorId: "u1", content: "!!setclear", permissionKey: "server.selfclear.manage" }));
    await handleSetClearInteraction(fakeModalSubmit({ guildId, action: "noms", userId: "u1", valeur: "jamaisenregistre" }));

    const annulation = fakeInteraction({ guildId, customId: "setclear:annuler", userId: "u1", permissionKey: "server.selfclear.manage" });
    await handleSetClearInteraction(annulation);
    assert.strictEqual(annulation._updates.length, 1);
    assert.deepStrictEqual(selfClearStore.getConfig(guildId).names, ["referencenontouchee"]);
  });

  console.log("\nBout en bout — la config configurée est réellement utilisée par `<nom> clear` :");

  await cas("après confirmation, le NOUVEAU nom déclenche, l'ancien « uo » ne déclenche plus", async () => {
    const guildId = "g-e2e";
    selfClearStore.setNames(guildId, ["kash"]);
    selfClearStore.setCooldown(guildId, 60_000);

    const salon = [];
    const channel = {
      id: "c1",
      messages: { fetch: async () => new Collection() },
      bulkDelete: async () => new Collection(),
      send: async () => ({ edit: async () => {}, delete: async () => {} }),
    };

    const uoClear = { content: "uo clear", author: { id: "u1", bot: false }, guild: { id: guildId }, channel };
    assert.strictEqual(await handleSelfClear({ user: { id: "bot-1" } }, uoClear), false, "« uo clear » ne doit plus déclencher");

    const kashClear = { content: "kash clear", author: { id: "u2", bot: false }, guild: { id: guildId }, channel };
    assert.strictEqual(await handleSelfClear({ user: { id: "bot-1" } }, kashClear), true, "« kash clear » doit déclencher");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
