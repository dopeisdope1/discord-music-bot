/**
 * Vérifie "!!confess" (utils/confessions.js) : parcours de confession
 * anonyme EN PLUSIEURS ÉTAPES, reproduisant la capture fournie — carte
 * "Confesse-toi", bouton "Je souhaite participer" -> message anonyme tapé
 * dans une MODALE Discord (jamais en MP) -> anonyme ou non -> attente de
 * validation (si configurée) -> publication.
 *
 * Versions refusées en cours de route, dans l'ordre : message dans la
 * commande texte directement, message demandé en MP, une étape garçon/fille
 * avant le message, un cadre gris (ContainerBuilder) autour de la carte, des
 * réactions 👍/👎 posées automatiquement, un titre "Confession #N" affiché.
 * Ce fichier teste la version actuelle, la plus simple des six.
 *
 * Lancement : node scripts/test-confessions.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "confessions-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { handleConfessTextCommand, handleConfessInteraction } = require("../utils/confessions");
const confessStore = require("../utils/confessStore");
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
    isTextBased: () => true,
    send: async (payload) => {
      const msg = { embeds: payload.embeds };
      envois.push({ payload, msg });
      return msg;
    },
    _envois: envois,
  };
}

/** Un Components V2 sans ContainerBuilder : `payload.components` est un tableau PLAT de builders — jamais un seul Container à dérouler. */
function partiesJSON(payload) {
  return payload.components.map((c) => c.toJSON());
}

/** Un environnement = un serveur, avec un registre d'utilisateurs partagé (pour que interaction.user et client.users.fetch(id) renvoient LE MÊME objet, MP compris). */
function makeEnv(guildId) {
  const users = new Map();
  function getUser(id) {
    if (!users.has(id)) {
      const dms = [];
      users.set(id, { id, tag: `${id}#0001`, send: async (c) => dms.push(c), _dms: dms });
    }
    return users.get(id);
  }
  const guild = { id: guildId, channels: { cache: new Collection() } };
  const client = {
    guilds: { cache: new Collection([[guildId, guild]]) },
    users: { fetch: async (id) => users.get(id) || null },
  };
  guild.client = client;
  return { guild, client, getUser };
}

function fakeInteraction(env, { customId, userId, values, permissionKey }) {
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
    member: { id: userId, guild: { id: env.guild.id }, roles: { cache: new Collection() } },
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

/** La soumission de la modale "confess:message" (voir utils/confessions.js) — le texte se tape ici, jamais en MP. */
function fakeModalSubmit(env, userId, texte) {
  const i = fakeInteraction(env, { customId: "confess:message", userId });
  i.isModalSubmit = () => true;
  i.fields = { getTextInputValue: (champ) => (champ === "texte" ? texte : null) };
  return i;
}

function fakeSetupMessage(env, { authorId, content, channel }) {
  const replies = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guild: env.guild,
    channel: channel || fakeChannel("chan-defaut"),
    member: { id: authorId, guild: { id: env.guild.id }, roles: { cache: new Collection() } },
    reply: async (p) => replies.push(p),
    _replies: replies,
  };
}

/** L'id de validation est un compteur global sur tout le fichier (comme en vrai) — on le lit sur le vrai bouton plutôt que de le deviner. */
function customIdDuBouton(envoi, label) {
  const bouton = envoi.payload.components[0].components.find((b) => (b.data?.label || b.label) === label);
  return bouton.data?.custom_id || bouton.custom_id;
}

(async () => {
  console.log("Mot-clé et préfixe :");

  await cas('un mot inconnu après "!!" reste silencieux', async () => {
    const env = makeEnv("g-mot");
    const msg = fakeSetupMessage(env, { authorId: "u1", content: "!!nimportequoi" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas('le préfixe "&" n\'est pas concerné', async () => {
    const env = makeEnv("g-prefixe");
    const msg = fakeSetupMessage(env, { authorId: "u1", content: "&confess setup" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log("\n!!confess setup / validation :");

  await cas("sans channels.manage, setup et validation sont refusés", async () => {
    const env = makeEnv("g-setup-refus");
    const channel = fakeChannel("chan-1");
    const msg1 = fakeSetupMessage(env, { authorId: "u-sans", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, msg1);
    assert.ok(msg1._replies[0]?.includes?.("pas la permission"));
    assert.strictEqual(confessStore.getConfig("g-setup-refus").channelId, null);

    const msg2 = fakeSetupMessage(env, { authorId: "u-sans", content: "!!confess validation", channel });
    await handleConfessTextCommand(null, msg2);
    assert.ok(msg2._replies[0]?.includes?.("pas la permission"));
  });

  await cas('"!!confess setup" poste la carte "Confesse-toi" avec une bordure colorée, avec ses 2 boutons', async () => {
    permStore.grantToUser("g-setup-ok", "u-admin", "channels.manage");
    const env = makeEnv("g-setup-ok");
    const channel = fakeChannel("chan-public");
    const msg = fakeSetupMessage(env, { authorId: "u-admin", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, msg);

    assert.strictEqual(confessStore.getConfig("g-setup-ok").channelId, "chan-public");
    assert.strictEqual(channel._envois.length, 1);
    const payload = channel._envois[0].payload;
    // Components V2 + une VRAIE carte visuelle (utils/confessCard.js) —
    // comme sur la capture fournie, SEULE la liste des étapes (pas le titre
    // "Comment participer ?" au-dessus) porte la bordure colorée.
    assert.strictEqual(payload.files?.length, 1, "doit joindre l'image de la carte visuelle");
    const parties = partiesJSON(payload);
    const conteneurs = parties.filter((c) => c.type === 17);
    assert.strictEqual(conteneurs.length, 1, "un seul ContainerBuilder — juste la liste des étapes");
    assert.ok(conteneurs[0].accent_color !== undefined && conteneurs[0].accent_color !== null, "doit porter une couleur d'accent (la bordure)");
    const texteConteneur = conteneurs.flatMap((c) => c.components).map((c) => c.content).join("\n");
    assert.ok(!texteConteneur.includes("Comment participer"), "le titre reste HORS de la bordure, comme sur la capture");
    assert.ok(parties.some((c) => c.type === 12), "doit contenir la galerie média (la carte)");
    const texte = [...parties.filter((c) => c.type === 10).map((c) => c.content), texteConteneur].join("\n");
    assert.ok(texte.includes("Comment participer"), texte);
    assert.ok(texte.includes("fenêtre qui s'ouvre"), "le parcours décrit ne doit plus mentionner de MP");
    assert.ok(!texte.includes("garçon"), "plus d'étape garçon/fille dans le parcours décrit");
    const rangeeBoutons = parties.find((c) => c.type === 1);
    const labels = rangeeBoutons.components.map((b) => b.label);
    assert.deepStrictEqual(labels, ["Je souhaite participer", "Gérer les notifications"]);
  });

  await cas('"!!confess validation" enregistre le salon de validation et confirme', async () => {
    permStore.grantToUser("g-valid-setup", "u-admin", "channels.manage");
    const env = makeEnv("g-valid-setup");
    const msg = fakeSetupMessage(env, { authorId: "u-admin", content: "!!confess validation" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(confessStore.getConfig("g-valid-setup").validationChannelId, "chan-defaut");
    assert.ok(msg._replies[0]?.includes?.("valider"));
  });

  console.log('\nParcours complet — "Je souhaite participer" (sans salon de validation, publication directe) :');

  await cas("étape 1 : cliquer ouvre DIRECTEMENT une modale — pas de garçon/fille, pas de MP", async () => {
    const env = makeEnv("g-flow-1");
    const publicChan = fakeChannel("chan-flow-1");
    confessStore.setChannel("g-flow-1", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);

    const i1 = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1" });
    await handleConfessInteraction(i1);
    assert.strictEqual(i1._modals.length, 1, "doit ouvrir une modale directement");
    assert.strictEqual(i1._replies.length, 0, "pas de question garçon/fille avant");
    assert.strictEqual(env.getUser("u-flow-1")._dms.length, 0, "aucun MP ne doit être envoyé");
    const champ = i1._modals[0].toJSON().components[0].components[0];
    assert.strictEqual(champ.style, 2, "un champ de confession doit être multi-lignes (Paragraph)");

    // Recliquer pendant que le parcours est en cours doit être refusé.
    const i1b = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1" });
    await handleConfessInteraction(i1b);
    assert.ok(i1b._replies[0].content.includes("déjà une confession en cours"));
  });

  await cas("étape 2 : la modale soumise propose de rester anonyme ou non", async () => {
    const env = makeEnv("g-flow-4");
    const publicChan = fakeChannel("chan-flow-4");
    confessStore.setChannel("g-flow-4", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-4" }));

    const soumission = fakeModalSubmit(env, "u-flow-4", "Voici mon secret le plus honteux");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("rester anonyme"));
    assert.strictEqual(soumission._replies[0].flags, 64, "doit rester éphémère");
    assert.strictEqual(soumission._replies[0].components[0].components.length, 2);
  });

  await cas("soumettre la modale SANS avoir cliqué start avant est refusé (étape expirée)", async () => {
    const env = makeEnv("g-flow-3b");
    const soumission = fakeModalSubmit(env, "u-jamais-start", "un message");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("expiré"));
  });

  await cas("un message vide dans la modale ne fait pas avancer l'étape", async () => {
    const env = makeEnv("g-flow-5");
    const publicChan = fakeChannel("chan-flow-5");
    confessStore.setChannel("g-flow-5", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-5" }));

    const soumissionVide = fakeModalSubmit(env, "u-flow-5", "   ");
    await handleConfessInteraction(soumissionVide);
    assert.ok(soumissionVide._replies[0].content.includes("vide"));

    // La vraie soumission suit ensuite normalement (l'étape n'a pas changé).
    const soumission = fakeModalSubmit(env, "u-flow-5", "un vrai message cette fois");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("rester anonyme"));
  });

  await cas("étape 3 : choisir anonyme PUBLIE directement (sans salon de validation configuré), sans cadre ni réaction", async () => {
    const env = makeEnv("g-flow-6");
    const publicChan = fakeChannel("chan-flow-6");
    confessStore.setChannel("g-flow-6", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-6" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-flow-6", "Baisons eren les amis"));

    const iAnon = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-flow-6" });
    await handleConfessInteraction(iAnon);

    assert.ok(iAnon._updates[0].content.includes("publiée"));
    assert.strictEqual(publicChan._envois.length, 1);
    const payload = publicChan._envois[0].payload;
    // Le message DEVIENT le gros texte de la carte visuelle (image) — on ne
    // peut plus le lire dans le JSON, mais son texte alternatif (accessibilité,
    // même convention que le reste du panel) le porte encore intact.
    assert.strictEqual(payload.files[0].description, "Baisons eren les amis");
    const parties = partiesJSON(payload);
    assert.ok(!parties.some((c) => c.type === 17), "aucun ContainerBuilder — pas de cadre gris");
    assert.ok(!parties.some((c) => c.content?.includes("Confession #")), "plus de titre numéroté");
    assert.ok(!parties.some((c) => c.type === 10), "plus de légende du tout sous l'image (demande explicite)");
    assert.strictEqual(publicChan._envois[0].msg.react, undefined, "aucune réaction ne doit être posée automatiquement");
  });

  await cas("choisir de ne PAS rester anonyme n'affiche quand même RIEN publiquement (plus de légende)", async () => {
    const env = makeEnv("g-flow-7");
    const publicChan = fakeChannel("chan-flow-7");
    confessStore.setChannel("g-flow-7", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-7" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-flow-7", "message assumé"));
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:anon:non", userId: "u-flow-7" }));

    const parties = partiesJSON(publicChan._envois[0].payload);
    assert.ok(!parties.some((c) => c.type === 10), "aucune légende, même en pseudo — la publication publique reste muette sur l'auteur");
  });

  await cas("choisir anonyme/non SANS avoir soumis de message avant est refusé", async () => {
    const env = makeEnv("g-flow-8");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-8" }));
    // On saute directement à "anon" sans passer par la modale.
    const i = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-flow-8" });
    await handleConfessInteraction(i);
    assert.ok(i._replies[0].content.includes("expiré"));
  });

  console.log("\nAvec un salon de validation configuré :");

  await cas("choisir anonyme/non ENVOIE EN VALIDATION au lieu de publier direct", async () => {
    const env = makeEnv("g-validation");
    const publicChan = fakeChannel("chan-val-public");
    const validChan = fakeChannel("chan-val-staff");
    confessStore.setChannel("g-validation", publicChan.id);
    confessStore.setValidationChannel("g-validation", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-val-1" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-val-1", "en attente de validation"));
    const iAnon = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-val-1" });
    await handleConfessInteraction(iAnon);

    assert.strictEqual(publicChan._envois.length, 0, "rien ne doit être publié tant que ce n'est pas validé");
    assert.strictEqual(validChan._envois.length, 1);
    assert.ok(iAnon._updates[0].content.includes("attente de validation"));

    const labels = validChan._envois[0].payload.components[0].components.map((b) => b.data?.label || b.label);
    assert.deepStrictEqual(labels, ["Approuver", "Refuser"]);

    // Le choix anonyme/pseudo ne sert plus qu'ici : la carte de validation,
    // réservée au staff — la publication publique, elle, ne montre jamais
    // l'auteur (voir les cas ci-dessus).
    const embedValidation = validChan._envois[0].payload.embeds[0].toJSON();
    assert.ok(embedValidation.fields.some((f) => f.name === "Auteur" && f.value.includes("u-val-1")), JSON.stringify(embedValidation.fields));
  });

  await cas("Approuver publie ENFIN la confession et prévient l'auteur par MP", async () => {
    const env = makeEnv("g-approuve");
    const publicChan = fakeChannel("chan-app-public");
    const validChan = fakeChannel("chan-app-staff");
    confessStore.setChannel("g-approuve", publicChan.id);
    confessStore.setValidationChannel("g-approuve", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-app-1" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-app-1", "coucou le staff"));
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-app-1" }));

    const customIdApprouve = customIdDuBouton(validChan._envois[0], "Approuver");
    const iValid = fakeInteraction(env, { customId: customIdApprouve, userId: "u-mod-1", permissionKey: "channels.manage" });
    await handleConfessInteraction(iValid);

    assert.strictEqual(publicChan._envois.length, 1, "doit être publié après approbation");
    assert.ok(iValid._updates[0].content.includes("approuvée"));
    assert.ok(env.getUser("u-app-1")._dms.some((d) => d.includes("validée")), env.getUser("u-app-1")._dms);
  });

  await cas("Refuser ne publie rien et prévient l'auteur par MP", async () => {
    const env = makeEnv("g-refuse");
    const publicChan = fakeChannel("chan-ref-public");
    const validChan = fakeChannel("chan-ref-staff");
    confessStore.setChannel("g-refuse", publicChan.id);
    confessStore.setValidationChannel("g-refuse", validChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);
    env.guild.channels.cache.set(validChan.id, validChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-ref-1" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-ref-1", "message qui va être refusé"));
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:anon:non", userId: "u-ref-1" }));

    const customIdRefuse = customIdDuBouton(validChan._envois[0], "Refuser");
    const iValid = fakeInteraction(env, { customId: customIdRefuse, userId: "u-mod-2", permissionKey: "channels.manage" });
    await handleConfessInteraction(iValid);

    assert.strictEqual(publicChan._envois.length, 0);
    assert.ok(iValid._updates[0].content.includes("refusée"));
    assert.ok(env.getUser("u-ref-1")._dms.some((d) => d.includes("n'a pas été validée")));
  });

  await cas("sans channels.manage, Approuver/Refuser sont refusés", async () => {
    const env = makeEnv("g-refus-mod");
    const iValid = fakeInteraction(env, { customId: "confess:valider:approuve:999", userId: "u-pas-mod" });
    await handleConfessInteraction(iValid);
    assert.ok(iValid._replies[0].content.includes("pas la permission"));
  });

  await cas("valider un id déjà traité (ou inconnu) ne plante pas, le dit clairement", async () => {
    const env = makeEnv("g-id-inconnu");
    const iValid = fakeInteraction(env, { customId: "confess:valider:approuve:99999", userId: "u-mod-3", permissionKey: "channels.manage" });
    await handleConfessInteraction(iValid);
    assert.ok(iValid._updates[0].content.includes("plus en attente"));
  });

  console.log("\nNotifications :");

  await cas('"Gérer les notifications" bascule ON puis OFF, en éphémère', async () => {
    const env = makeEnv("g-notif");
    const i1 = fakeInteraction(env, { customId: "confess:notif", userId: "u-notif-1" });
    await handleConfessInteraction(i1);
    assert.ok(i1._replies[0].content.includes("recevras"));
    assert.strictEqual(i1._replies[0].flags, 64);

    const i2 = fakeInteraction(env, { customId: "confess:notif", userId: "u-notif-1" });
    await handleConfessInteraction(i2);
    assert.ok(i2._replies[0].content.includes("désactivées"));
  });

  await cas("les personnes inscrites reçoivent un MP à la publication, pas l'auteur lui-même", async () => {
    const env = makeEnv("g-notif-pub");
    const publicChan = fakeChannel("chan-notif-pub");
    confessStore.setChannel("g-notif-pub", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);

    // u-notif-abo s'inscrit, l'auteur ne s'inscrit pas.
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:notif", userId: "u-notif-abo" }));

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-notif-auteur" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-notif-auteur", "ma confession"));
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-notif-auteur" }));

    // Laisse les .then() asynchrones de notification se résoudre.
    await new Promise((r) => setTimeout(r, 20));

    assert.ok(env.getUser("u-notif-abo")._dms.some((d) => d.includes("Nouvelle confession")));
    assert.ok(!env.getUser("u-notif-auteur")._dms.some((d) => d.includes("Nouvelle confession")), "l'auteur ne doit pas se notifier lui-même");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
