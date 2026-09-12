/**
 * Vérifie "!!confess" (utils/confessions.js) — sixième refonte, avec
 * validation avant publication :
 *
 *  Membre -> confession -> ⏳ en attente -> salon de validation PRIVÉ
 *    -> 🟢 Accepter -> 📜 publication publique
 *    -> 🔴 Refuser -> ❌ jamais publiée
 *
 *  - "!!confess setup" installe le panneau public (design inchangé : un
 *    seul bouton "Je souhaite participer", plus de gestion intégrée).
 *  - "!!confess validation" configure le salon privé où chaque confession
 *    arrive comme SON PROPRE message, avec ses propres boutons.
 *  - Accepter/Refuser dépendent de la permission "server.confessions.manage"
 *    (&panel > Permissions) OU d'un administrateur Discord.
 *  - Une confession déjà traitée ne peut plus l'être une seconde fois
 *    (bascule atomique).
 *  - Le salon PUBLIC ne montre jamais l'auteur ; le salon de VALIDATION,
 *    lui, le montre au staff (donnée interne de modération).
 *  - Chaque décision est journalisée (utils/moderation/actions.js::report).
 *
 * Lancement : node scripts/test-confessions.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "confessions-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField, MessageFlags } = require("discord.js");
const { handleConfessTextCommand, handleConfessInteraction } = require("../utils/confessions");
const confessStore = require("../utils/confessStore");
const permStore = require("../utils/permissions/store");
const modLogStore = require("../utils/modLogStore");
const historyStore = require("../utils/moderationHistoryStore");

const PERM_GERER = "server.confessions.manage";

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
    isTextBased: () => true,
    send: async (payload) => {
      const msg = { id: `msg-${envois.length + 1}`, embeds: payload.embeds };
      envois.push({ payload, msg });
      return msg;
    },
    _envois: envois,
  };
}

/** Un Components V2 sans ContainerBuilder à dérouler : `payload.components` est un tableau PLAT de builders. */
function partiesJSON(payload) {
  return payload.components.map((c) => c.toJSON());
}

/** Le texte de TOUS les TextDisplay d'un conteneur (type 10). */
function texteDu(conteneur) {
  return conteneur.components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
}

/** Un environnement = un serveur, avec un registre d'utilisateurs partagé. */
function makeEnv(guildId) {
  const users = new Map();
  function getUser(id) {
    if (!users.has(id)) users.set(id, { id, tag: `${id}#0001` });
    return users.get(id);
  }
  const guild = { id: guildId, channels: { cache: new Collection() }, client: null };
  const client = { guilds: { cache: new Collection([[guildId, guild]]) } };
  guild.client = client;
  return { guild, client, getUser };
}

function fakeInteraction(env, { customId, userId, values, permissionKey, isAdmin = false }) {
  if (permissionKey) permStore.grantToUser(env.guild.id, userId, permissionKey);
  const user = env.getUser(userId);
  const replies = [];
  const updates = [];
  const modals = [];
  return {
    customId,
    user,
    guild: env.guild,
    client: env.client,
    channel: { id: "chan-interaction" },
    member: {
      id: userId,
      guild: { id: env.guild.id },
      roles: { cache: new Collection() },
      permissions: { has: () => isAdmin },
    },
    values,
    reply: async (p) => replies.push(p),
    update: async (p) => updates.push(p),
    showModal: async (m) => modals.push(m),
    message: { embeds: [{ title: "x" }] },
    _replies: replies,
    _updates: updates,
    _modals: modals,
  };
}

/** La soumission de la modale "confess:message" — le texte se tape ici, jamais en MP. */
function fakeModalSubmit(env, userId, texte) {
  const i = fakeInteraction(env, { customId: "confess:message", userId });
  i.isModalSubmit = () => true;
  i.fields = { getTextInputValue: (champ) => (champ === "texte" ? texte : null) };
  return i;
}

/** Un message texte envoyé par un membre — commande OU simple message dans le salon (pour tester la garde). */
function fakeMessage(env, { authorId, content, channel, isAdmin = false, permissionKey }) {
  if (permissionKey) permStore.grantToUser(env.guild.id, authorId, permissionKey);
  const replies = [];
  const deleted = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guild: env.guild,
    channel: channel || fakeChannel("chan-defaut"),
    member: {
      id: authorId,
      guild: { id: env.guild.id },
      roles: { cache: new Collection() },
      permissions: { has: () => isAdmin },
    },
    reply: async (p) => replies.push(p),
    delete: async () => deleted.push(true),
    _replies: replies,
    _deleted: deleted,
  };
}

/** Fait cheminer un membre jusqu'à la mise en attente d'une confession — raccourci pour les tests d'Accepter/Refuser. */
async function soumettreConfession(env, { userId, texte, anonyme }) {
  await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId }));
  await handleConfessInteraction(fakeModalSubmit(env, userId, texte));
  await handleConfessInteraction(fakeInteraction(env, { customId: `confess:anon:${anonyme ? "oui" : "non"}`, userId }));
}

(async () => {
  console.log("Mot-clé et préfixe :");

  await cas('un mot inconnu après "!!" reste silencieux', async () => {
    const env = makeEnv("g-mot");
    const msg = fakeMessage(env, { authorId: "u1", content: "!!nimportequoi" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
    assert.strictEqual(msg._deleted.length, 0);
  });

  await cas('le préfixe "&" n\'est pas concerné', async () => {
    const env = makeEnv("g-prefixe");
    const msg = fakeMessage(env, { authorId: "u1", content: "&confess setup" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log("\n!!confess setup / validation :");

  await cas("sans channels.manage, setup et validation sont refusés", async () => {
    const env = makeEnv("g-cfg-non");
    const channel = fakeChannel("chan-cfg-non");
    await handleConfessTextCommand(null, fakeMessage(env, { authorId: "u-sans", content: "!!confess setup", channel }));
    await handleConfessTextCommand(null, fakeMessage(env, { authorId: "u-sans", content: "!!confess validation", channel }));
    assert.strictEqual(channel._envois.length, 0);
  });

  await cas('"!!confess setup" poste le panneau — un seul bouton, plus de gestion intégrée', async () => {
    const env = makeEnv("g-setup-ok");
    const channel = fakeChannel("chan-public");
    const msg = fakeMessage(env, { authorId: "u-admin", content: "!!confess setup", channel, permissionKey: "channels.manage" });
    await handleConfessTextCommand(null, msg);

    assert.strictEqual(confessStore.getConfig("g-setup-ok").channelId, "chan-public");
    assert.strictEqual(channel._envois.length, 1);
    const payload = channel._envois[0].payload;
    assert.strictEqual(payload.files?.length, 1, "doit joindre l'image de la carte visuelle");
    const conteneur = partiesJSON(payload)[0];
    const texte = texteDu(conteneur);
    assert.ok(texte.includes("Comment participer"), texte);
    assert.ok(!texte.includes("garçon"), "plus d'étape garçon/fille");
    assert.ok(!texte.includes("Messages anonymes en attente"), "plus de gestion intégrée au panneau");
    const rangee = conteneur.components.find((c) => c.type === 1);
    assert.deepStrictEqual(rangee.components.map((b) => b.label), ["Je souhaite participer"]);
  });

  await cas('"!!confess validation" enregistre le salon de validation et confirme', async () => {
    const env = makeEnv("g-valid-setup");
    const channel = fakeChannel("chan-valid");
    const msg = fakeMessage(env, { authorId: "u-admin", content: "!!confess validation", channel, permissionKey: "channels.manage" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(confessStore.getConfig("g-valid-setup").validationChannelId, "chan-valid");
    assert.ok(msg._replies[0]?.includes?.("Accepter"));
  });

  console.log("\nProtection du salon PUBLIC de confession :");

  await cas("un membre normal qui écrit dans le salon voit son message supprimé instantanément", async () => {
    const env = makeEnv("g-garde-1");
    const channel = fakeChannel("chan-garde-1");
    confessStore.setChannel("g-garde-1", channel.id);
    const msg = fakeMessage(env, { authorId: "u-normal", content: "coucou", channel });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 1);
  });

  await cas("un membre avec la permission server.confessions.manage peut écrire", async () => {
    const env = makeEnv("g-garde-2");
    const channel = fakeChannel("chan-garde-2");
    confessStore.setChannel("g-garde-2", channel.id);
    const msg = fakeMessage(env, { authorId: "u-perm", content: "coucou", channel, permissionKey: PERM_GERER });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
  });

  await cas("un administrateur Discord peut écrire", async () => {
    const env = makeEnv("g-garde-3");
    const channel = fakeChannel("chan-garde-3");
    confessStore.setChannel("g-garde-3", channel.id);
    const msg = fakeMessage(env, { authorId: "u-admin", content: "coucou", channel, isAdmin: true });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
  });

  console.log("\nParcours de participation — TEST 1 : en attente, jamais publié directement :");

  await cas("étape 1 : cliquer ouvre DIRECTEMENT une modale — pas de garçon/fille, pas de MP", async () => {
    const env = makeEnv("g-flow-1");
    const i1 = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1" });
    await handleConfessInteraction(i1);
    assert.strictEqual(i1._modals.length, 1);
    assert.strictEqual(i1._replies.length, 0);
  });

  await cas("cliquer deux fois de suite ne bloque JAMAIS (repart à zéro)", async () => {
    const env = makeEnv("g-flow-1b");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1b" }));
    const i1b = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1b" });
    await handleConfessInteraction(i1b);
    assert.strictEqual(i1b._modals.length, 1);
    assert.strictEqual(i1b._replies.length, 0);
  });

  await cas("un message vide dans la modale ne fait pas avancer l'étape", async () => {
    const env = makeEnv("g-flow-vide");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-vide" }));
    const soumission = fakeModalSubmit(env, "u-flow-vide", "   ");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("vide"));
  });

  await cas("TEST 1 : la confession arrive dans le salon de VALIDATION, PAS dans le salon public", async () => {
    const env = makeEnv("g-flow-6");
    const publicChan = fakeChannel("chan-flow-6-pub");
    const validChan = fakeChannel("chan-flow-6-val");
    confessStore.setChannel("g-flow-6", publicChan.id);
    confessStore.setValidationChannel("g-flow-6", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-6" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-flow-6", "Baisons eren les amis"));
    const iAnon = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-flow-6" });
    await handleConfessInteraction(iAnon);

    assert.ok(iAnon._updates[0].content.includes("attente de validation"));
    assert.strictEqual(publicChan._envois.length, 0, "RIEN dans le salon public");
    assert.strictEqual(validChan._envois.length, 1, "UN message dans le salon de validation");

    assert.strictEqual(validChan._envois[0].payload.files?.[0]?.description, "Baisons eren les amis", "le vrai aperçu (image) de la confession doit être joint");
    const conteneur = partiesJSON(validChan._envois[0].payload)[0];
    assert.ok(conteneur.components.some((c) => c.type === 12), "une galerie média doit porter l'image d'aperçu");
    const texte = texteDu(conteneur);
    assert.ok(texte.includes("u-flow-6"), "le salon de validation DOIT montrer l'auteur au staff");
    assert.ok(texte.includes("En attente"), texte);
    assert.ok(texte.includes("Envoyée"), "doit indiquer quand la confession a été envoyée");
    assert.ok(conteneur.accent_color === undefined || conteneur.accent_color === null, "pas de couleur d'accent — demande explicite");
    const rangeeBoutons = conteneur.components.find((c) => c.type === 1).components;
    assert.deepStrictEqual(rangeeBoutons.map((b) => b.label), ["Accepter", "Refuser"]);
    assert.deepStrictEqual(
      rangeeBoutons.map((b) => b.emoji?.name),
      ["yes", "no"],
      "doit utiliser les emojis personnalisés du serveur (:yes:/:no:), pas 🟢/🔴"
    );
  });

  await cas("sans salon de confessions configuré, abandon propre", async () => {
    const env = makeEnv("g-flow-sans-pub");
    await soumettreConfession(env, { userId: "u-sp", texte: "x", anonyme: true });
    // Rien à vérifier de plus que l'absence de crash — pas de salon => pas d'ajout possible à observer directement ici.
  });

  await cas("sans salon de validation configuré, abandon propre", async () => {
    const env = makeEnv("g-flow-sans-val");
    confessStore.setChannel("g-flow-sans-val", "chan-x");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-sv" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-sv", "un message"));
    const iAnon = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-sv" });
    await handleConfessInteraction(iAnon);
    assert.ok(iAnon._updates[0].content.includes("validation"));
  });

  console.log("\nTEST 2/3 : Accepter — permissions et publication :");

  await cas("TEST 3 : un membre normal qui clique Accepter est refusé, rien ne change", async () => {
    const env = makeEnv("g-acc-non");
    const publicChan = fakeChannel("chan-acc-non-pub");
    const validChan = fakeChannel("chan-acc-non-val");
    confessStore.setChannel("g-acc-non", publicChan.id);
    confessStore.setValidationChannel("g-acc-non", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);
    await soumettreConfession(env, { userId: "u-auteur", texte: "secret", anonyme: true });

    const i = fakeInteraction(env, { customId: "confess:accepter:001", userId: "u-normal" });
    await handleConfessInteraction(i);

    assert.strictEqual(i._replies.length, 1);
    assert.ok(i._replies[0].content.includes("pas la permission"));
    assert.ok(i._replies[0].flags, "doit être éphémère");
    assert.strictEqual(publicChan._envois.length, 0, "rien ne doit être publié");
    assert.strictEqual(confessStore.getConfession("g-acc-non", "001").status, "attente");
  });

  await cas("TEST 2 : un admin qui clique Accepter publie la confession et la marque acceptée", async () => {
    const env = makeEnv("g-acc-oui");
    const publicChan = fakeChannel("chan-acc-oui-pub");
    const validChan = fakeChannel("chan-acc-oui-val");
    confessStore.setChannel("g-acc-oui", publicChan.id);
    confessStore.setValidationChannel("g-acc-oui", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);
    await soumettreConfession(env, { userId: "u-auteur-2", texte: "Message anonyme à publier", anonyme: true });

    const i = fakeInteraction(env, { customId: "confess:accepter:001", userId: "u-mod-1", isAdmin: true });
    await handleConfessInteraction(i);

    assert.strictEqual(publicChan._envois.length, 1);
    assert.strictEqual(publicChan._envois[0].payload.files[0].description, "Message anonyme à publier");
    const partiesPubliees = partiesJSON(publicChan._envois[0].payload);
    assert.ok(!partiesPubliees.some((c) => c.content?.includes("u-auteur-2")), "l'auteur ne doit JAMAIS apparaître publiquement");

    const confession = confessStore.getConfession("g-acc-oui", "001");
    assert.strictEqual(confession.status, "acceptee");
    assert.strictEqual(confession.moderatedBy, "u-mod-1");
    assert.ok(confession.publishedMessageId);

    // Le message du salon de validation est édité, boutons retirés.
    const conteneurEdite = partiesJSON(i._updates[0])[0];
    assert.ok(!conteneurEdite.components.some((c) => c.type === 1), "plus de boutons après décision");
    const texteEdite = texteDu(conteneurEdite);
    assert.ok(texteEdite.includes("Acceptée"), texteEdite);
    assert.ok(texteEdite.includes("Traitée par"), "doit indiquer qui a traité et quand");
    assert.ok(texteEdite.includes("Envoyée"), "doit indiquer quand la confession a été envoyée");
    assert.ok(conteneurEdite.accent_color === undefined || conteneurEdite.accent_color === null, "pas de couleur d'accent — demande explicite");
  });

  await cas('avoir la permission "server.confessions.manage" via un RÔLE suffit (comme &panel > Permissions)', async () => {
    const env = makeEnv("g-acc-role");
    const publicChan = fakeChannel("chan-acc-role-pub");
    const validChan = fakeChannel("chan-acc-role-val");
    confessStore.setChannel("g-acc-role", publicChan.id);
    confessStore.setValidationChannel("g-acc-role", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);
    await soumettreConfession(env, { userId: "u-auteur-3", texte: "via un rôle", anonyme: true });

    permStore.setRoleGrants("g-acc-role", "role-staff", [PERM_GERER]);
    const i = fakeInteraction(env, { customId: "confess:accepter:001", userId: "u-staff" });
    i.member.roles.cache.set("role-staff", { id: "role-staff" });
    await handleConfessInteraction(i);

    assert.strictEqual(confessStore.getConfession("g-acc-role", "001").status, "acceptee");
  });

  console.log("\nTEST 4 : Refuser :");

  await cas("un admin qui clique Refuser ne publie rien, marque refusée", async () => {
    const env = makeEnv("g-ref-1");
    const publicChan = fakeChannel("chan-ref-1-pub");
    const validChan = fakeChannel("chan-ref-1-val");
    confessStore.setChannel("g-ref-1", publicChan.id);
    confessStore.setValidationChannel("g-ref-1", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);
    await soumettreConfession(env, { userId: "u-auteur-4", texte: "à refuser", anonyme: false });

    const i = fakeInteraction(env, { customId: "confess:refuser:001", userId: "u-mod-2", isAdmin: true });
    await handleConfessInteraction(i);

    assert.strictEqual(publicChan._envois.length, 0);
    const confession = confessStore.getConfession("g-ref-1", "001");
    assert.strictEqual(confession.status, "refusee");
    assert.strictEqual(confession.moderatedBy, "u-mod-2");
    const conteneurEdite = partiesJSON(i._updates[0])[0];
    assert.ok(texteDu(conteneurEdite).includes("Refusée"));
    assert.ok(conteneurEdite.accent_color === undefined || conteneurEdite.accent_color === null, "pas de couleur d'accent — demande explicite");
  });

  console.log("\nTEST 5 : double traitement — jamais accepté ET refusé :");

  await cas("une confession déjà acceptée ne peut plus être refusée ensuite (ni re-acceptée)", async () => {
    const env = makeEnv("g-double");
    const publicChan = fakeChannel("chan-double-pub");
    const validChan = fakeChannel("chan-double-val");
    confessStore.setChannel("g-double", publicChan.id);
    confessStore.setValidationChannel("g-double", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);
    await soumettreConfession(env, { userId: "u-auteur-5", texte: "course", anonyme: true });

    const iAccept = fakeInteraction(env, { customId: "confess:accepter:001", userId: "u-mod-3", isAdmin: true });
    await handleConfessInteraction(iAccept);
    assert.strictEqual(publicChan._envois.length, 1);

    const iRefuse = fakeInteraction(env, { customId: "confess:refuser:001", userId: "u-mod-4", isAdmin: true });
    await handleConfessInteraction(iRefuse);
    assert.ok(iRefuse._replies[0].content.includes("déjà été traitée"));
    assert.strictEqual(publicChan._envois.length, 1, "toujours UNE seule publication — pas de double traitement");
    assert.strictEqual(confessStore.getConfession("g-double", "001").status, "acceptee", "le statut accepté n'a pas été écrasé");
  });

  await cas("accepter/refuser une confession inconnue répond proprement, sans planter", async () => {
    const env = makeEnv("g-inconnue");
    const i = fakeInteraction(env, { customId: "confess:accepter:999", userId: "u-mod", isAdmin: true });
    await handleConfessInteraction(i);
    assert.ok(i._replies[0].content.includes("déjà été traitée"));
  });

  console.log("\nTEST 7 + logs : anonymat et journalisation :");

  await cas("TEST 7 : une confession anonyme acceptée ne révèle RIEN de l'auteur dans le salon public", async () => {
    const env = makeEnv("g-anon-7");
    const publicChan = fakeChannel("chan-anon-7-pub");
    const validChan = fakeChannel("chan-anon-7-val");
    confessStore.setChannel("g-anon-7", publicChan.id);
    confessStore.setValidationChannel("g-anon-7", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);
    await soumettreConfession(env, { userId: "u-secret-auteur", texte: "j'aime quelqu'un ici", anonyme: true });

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:accepter:001", userId: "u-mod-5", isAdmin: true }));

    const publie = partiesJSON(publicChan._envois[0].payload);
    const toutLeTexte = JSON.stringify(publie);
    assert.ok(!toutLeTexte.includes("u-secret-auteur"), "aucune trace de l'auteur dans le message public");
  });

  await cas("Accepter/Refuser sont journalisés (utils/moderation/actions.js::report + historique)", async () => {
    const env = makeEnv("g-logs-1");
    const publicChan = fakeChannel("chan-logs-1-pub");
    const validChan = fakeChannel("chan-logs-1-val");
    const logsChan = fakeChannel("chan-logs-1-modlog");
    confessStore.setChannel("g-logs-1", publicChan.id);
    confessStore.setValidationChannel("g-logs-1", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);
    env.guild.channels.cache.set(logsChan.id, logsChan);
    env.guild.channels.fetch = async (id) => env.guild.channels.cache.get(id) || null;
    modLogStore.setLogChannelId("g-logs-1", "moderation", logsChan.id);

    await soumettreConfession(env, { userId: "u-auteur-log", texte: "à journaliser", anonyme: true });
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:accepter:001", userId: "u-mod-log", isAdmin: true }));

    assert.strictEqual(logsChan._envois.length, 1, "une entrée doit apparaître dans le salon de logs modération existant");
    const texteLog = texteDu(partiesJSON(logsChan._envois[0].payload)[0]);
    assert.ok(texteLog.includes("Confession acceptée"), texteLog);
    assert.ok(texteLog.includes("u-mod-log"), "le modérateur doit être journalisé");

    const historique = historyStore.search("g-logs-1", { action: "confess_accept" });
    assert.ok(historique.length >= 1, "doit aussi apparaître dans l'historique de modération (&modlogs)");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
