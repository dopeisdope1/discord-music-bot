/**
 * Vérifie "!!setclear" (utils/setClearCommand.js) : configure PAR SERVEUR les
 * mots qui déclenchent le nettoyage automatique ("<mot> clear", voir
 * utils/selfClear.js) et le délai entre deux usages — remplace l'ancien
 * "uo clear" fixé en dur et son quota fixe de 2 usages/25min.
 *
 *  - Permission dédiée du catalogue existant (&panel > Permissions) :
 *    "server.selfclear.manage", ou administrateur Discord.
 *  - UN SEUL aller-retour : "Modifier" ouvre directement une modale avec les
 *    deux réglages ensemble, la soumission écrit tout de suite dans
 *    utils/selfClearStore.js — pas de brouillon ni d'étape "Confirmer".
 *  - "Valeurs par défaut" réinitialise en un clic.
 *  - Une fois enregistrée, utils/selfClear.js utilise réellement la config
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

function fakeInteraction({ guildId, customId, userId, isAdmin = false, permissionKey }) {
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
    reply: async (p) => replies.push(p),
    update: async (p) => updates.push(p),
    showModal: async (m) => modals.push(m),
    _replies: replies,
    _updates: updates,
    _modals: modals,
  };
}

function fakeModalSubmit({ guildId, userId, noms, cooldown, permissionKey = "server.selfclear.manage" }) {
  const i = fakeInteraction({ guildId, customId: "setclear:editer", userId, permissionKey });
  i.fields = {
    getTextInputValue: (champ) => {
      if (champ === "noms") return noms;
      if (champ === "cooldown") return cooldown;
      return null;
    },
  };
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

  await cas("le panneau affiche le déclencheur par défaut (uo) et le délai par défaut (15min)", async () => {
    const channel = fakeChannel("c1");
    const msg = fakeMessage({ guildId: "g-defaut", authorId: "u-admin", content: "!!setclear", channel, permissionKey: "server.selfclear.manage" });
    await handleSetClearTextCommand(null, msg);
    const conteneur = channel._envois[0].payload.components[0].toJSON();
    const texte = texteDu(conteneur);
    assert.ok(texte.includes("uo clear"), texte);
    assert.ok(texte.includes("15min"), texte);
    const boutons = conteneur.components.find((c) => c.type === 1 && c.components[0]?.type === 2);
    assert.deepStrictEqual(boutons.components.map((b) => b.label), ["Modifier", "Valeurs par défaut"]);
  });

  console.log("\nModifier — un seul aller-retour :");

  await cas("« Modifier » ouvre une modale préremplie avec les valeurs actuelles", async () => {
    const guildId = "g-modal";
    selfClearStore.setNames(guildId, ["kash", "oan"]);
    selfClearStore.setCooldown(guildId, 30 * 60_000);
    const i = fakeInteraction({ guildId, customId: "setclear:modifier", userId: "u1", permissionKey: "server.selfclear.manage" });
    await handleSetClearInteraction(i);
    assert.strictEqual(i._modals.length, 1);
    const [nomsField, cooldownField] = i._modals[0].components.map((row) => row.components[0]);
    assert.strictEqual(nomsField.data.value, "kash, oan");
    assert.strictEqual(cooldownField.data.value, "30min");
  });

  await cas("sans la permission, aucune modale ne s'ouvre", async () => {
    const i = fakeInteraction({ guildId: "g-refus", customId: "setclear:modifier", userId: "u-sans" });
    await handleSetClearInteraction(i);
    assert.strictEqual(i._modals.length, 0);
    assert.ok(i._replies.length > 0);
  });

  await cas("soumettre la modale enregistre DIRECTEMENT les deux réglages", async () => {
    const guildId = "g-soumission";
    const soumission = fakeModalSubmit({ guildId, userId: "u1", noms: "kash, zarok", cooldown: "1h" });
    await handleSetClearInteraction(soumission);

    const config = selfClearStore.getConfig(guildId);
    assert.deepStrictEqual(config.names, ["kash", "zarok"]);
    assert.strictEqual(config.cooldownMs, 60 * 60_000);
    assert.strictEqual(soumission._updates.length, 1, "la carte doit être mise à jour dans la foulée");
    const texte = texteDu(soumission._updates[0].components[0].toJSON());
    assert.ok(texte.includes("kash clear") && texte.includes("zarok clear"), texte);
  });

  await cas("une liste de noms vide est refusée, rien n'est écrit", async () => {
    const guildId = "g-noms-vides";
    selfClearStore.setNames(guildId, ["reference"]);
    const soumission = fakeModalSubmit({ guildId, userId: "u1", noms: "  ,  ,", cooldown: "15m" });
    await handleSetClearInteraction(soumission);
    assert.strictEqual(soumission._updates.length, 0);
    assert.ok(soumission._replies.length > 0);
    assert.deepStrictEqual(selfClearStore.getConfig(guildId).names, ["reference"]);
  });

  await cas("un délai invalide est refusé, rien n'est écrit", async () => {
    const guildId = "g-delai-invalide";
    selfClearStore.setCooldown(guildId, 42_000);
    const soumission = fakeModalSubmit({ guildId, userId: "u1", noms: "kash", cooldown: "pasunedureee" });
    await handleSetClearInteraction(soumission);
    assert.strictEqual(soumission._updates.length, 0);
    assert.ok(soumission._replies.length > 0);
    assert.strictEqual(selfClearStore.getConfig(guildId).cooldownMs, 42_000);
  });

  console.log("\nValeurs par défaut :");

  await cas("« Valeurs par défaut » réinitialise en un clic, sans modale", async () => {
    const guildId = "g-defaut-clic";
    selfClearStore.setNames(guildId, ["autrechose"]);
    selfClearStore.setCooldown(guildId, 5_000);

    const i = fakeInteraction({ guildId, customId: "setclear:reinitialiser", userId: "u1", permissionKey: "server.selfclear.manage" });
    await handleSetClearInteraction(i);

    assert.strictEqual(i._modals.length, 0);
    const config = selfClearStore.getConfig(guildId);
    assert.deepStrictEqual(config.names, selfClearStore.DEFAULT_NAMES);
    assert.strictEqual(config.cooldownMs, selfClearStore.DEFAULT_COOLDOWN_MS);
  });

  console.log("\nBout en bout — la config configurée est réellement utilisée par `<mot> clear` :");

  await cas("après enregistrement, le NOUVEAU mot déclenche, l'ancien « uo » ne déclenche plus", async () => {
    const guildId = "g-e2e";
    selfClearStore.setNames(guildId, ["kash"]);
    selfClearStore.setCooldown(guildId, 60_000);

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
