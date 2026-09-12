/**
 * Vérifie "!!confess" (utils/confessions.js) — cinquième refonte :
 *
 *  - "!!confess setup" reste la SEULE commande texte, elle installe le
 *    panneau public "Confesse-toi".
 *  - La gestion (menu déroulant, détail, Publier/Refuser/Retour/Fermer) est
 *    INTÉGRÉE à CE MÊME panneau — jamais un message séparé, ni éphémère.
 *    Cliquer "Gérer les confessions" (avec la permission) transforme le
 *    VRAI panneau public EN PLACE : visible par TOUT LE MONDE dans le
 *    salon à cet instant, pas seulement par qui a cliqué — compromis
 *    assumé et confirmé explicitement (Discord ne peut pas afficher un
 *    contenu différent selon qui regarde un même message).
 *  - Qui peut VOIR/GÉRER cette interface ET qui peut ÉCRIRE dans le salon
 *    dépendent TOUS LES DEUX de la MÊME permission
 *    "server.confessions.manage" du système EXISTANT de &panel >
 *    Permissions — plusieurs personnes possibles, pas un utilisateur
 *    unique codé en dur. Un clic sans cette permission reçoit un refus
 *    éphémère et NE MODIFIE PAS le panneau.
 *  - Aucune information sur l'auteur (pseudo, ID...) n'apparaît JAMAIS dans
 *    l'interface de gestion, même pour qui a la permission.
 *  - Une confession soumise n'est JAMAIS publiée automatiquement, et aucun
 *    MP n'est envoyé par le système (ni à l'auteur, ni à personne).
 *  - Cliquer "Je souhaite participer" repart TOUJOURS à zéro (jamais bloqué
 *    par un flux précédent abandonné) — bug réel rencontré en production.
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
      const msg = { embeds: payload.embeds };
      envois.push({ payload, msg });
      return msg;
    },
    _envois: envois,
  };
}

/** Le menu déroulant du panneau, s'il est présent (vue "liste" avec des confessions). */
function menuDuPanneau(conteneur) {
  for (const c of conteneur.components) {
    if (c.type !== 1) continue;
    const select = c.components.find((sub) => sub.type === 3);
    if (select) return select;
  }
  return null;
}

/** La rangée de boutons de GESTION (Publier/Refuser/Retour/Fermer) — distincte de la rangée "Je souhaite participer". */
function boutonsGestion(conteneur) {
  const rangee = conteneur.components.find((c) => c.type === 1 && c.components.some((b) => ["Publier", "Retour", "Fermer"].includes(b.label)));
  return rangee ? rangee.components.map((b) => b.label) : null;
}

/** Un Components V2 sans ContainerBuilder à dérouler : `payload.components` est un tableau PLAT de builders. */
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

/** Un message texte envoyé par un membre — commande OU simple message dans le salon (pour tester la garde). */
function fakeMessage(env, { authorId, content, channel, isAdmin = false, permissionKey, bot = false }) {
  if (permissionKey) permStore.grantToUser(env.guild.id, authorId, permissionKey);
  const replies = [];
  const deleted = [];
  return {
    content,
    author: { id: authorId, bot },
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

  await cas('"!!confess" seul (sans "setup") reste silencieux', async () => {
    const env = makeEnv("g-bare");
    const msg = fakeMessage(env, { authorId: "u1", content: "!!confess", permissionKey: "channels.manage" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log("\n!!confess setup :");

  await cas("sans channels.manage, setup est refusé", async () => {
    const env = makeEnv("g-setup-non");
    const channel = fakeChannel("chan-setup-non");
    const msg1 = fakeMessage(env, { authorId: "u-sans", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, msg1);
    assert.ok(msg1._replies[0]?.includes?.("pas la permission"));
  });

  await cas('"!!confess setup" poste le panneau de base, SANS aucun contenu de confession', async () => {
    const env = makeEnv("g-setup-ok");
    const channel = fakeChannel("chan-public");
    const msg = fakeMessage(env, { authorId: "u-admin", content: "!!confess setup", channel, permissionKey: "channels.manage" });
    await handleConfessTextCommand(null, msg);

    assert.strictEqual(confessStore.getConfig("g-setup-ok").channelId, "chan-public");
    assert.strictEqual(channel._envois.length, 1, "un seul message");
    const payload = channel._envois[0].payload;
    assert.strictEqual(payload.files?.length, 1, "doit joindre l'image de la carte visuelle");
    const parties = partiesJSON(payload);
    const conteneurs = parties.filter((c) => c.type === 17);
    assert.strictEqual(conteneurs.length, 1);
    assert.ok(conteneurs[0].accent_color === undefined || conteneurs[0].accent_color === null, "pas de couleur d'accent — gris par défaut");
    const interieur = conteneurs[0].components;
    assert.ok(interieur.some((c) => c.type === 12), "l'image du dégradé doit être DANS le cadre");
    const texte = interieur.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Comment participer"), texte);
    assert.ok(texte.includes("fenêtre qui s'ouvre"), "le parcours décrit ne doit plus mentionner de MP");
    assert.ok(!texte.includes("garçon"), "plus d'étape garçon/fille dans le parcours décrit");
    assert.ok(!texte.includes("Messages anonymes en attente"), "le panneau de base ne montre aucun contenu de confession");
    const rangee = interieur.find((c) => c.type === 1);
    assert.deepStrictEqual(rangee.components.map((b) => b.label), ["Je souhaite participer", "Gérer les confessions"]);
  });

  console.log("\nProtection du salon de confession :");

  await cas("un membre normal qui écrit dans le salon voit son message supprimé instantanément", async () => {
    const env = makeEnv("g-garde-1");
    const channel = fakeChannel("chan-garde-1");
    confessStore.setChannel("g-garde-1", channel.id);
    const msg = fakeMessage(env, { authorId: "u-normal", content: "coucou", channel });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 1, "le message doit être supprimé");
  });

  await cas("un membre avec la permission server.confessions.manage (via &panel > Permissions) peut écrire", async () => {
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

  await cas("un message ailleurs que dans le salon de confession n'est jamais supprimé", async () => {
    const env = makeEnv("g-garde-4");
    const channelConfession = fakeChannel("chan-garde-4");
    const autreSalon = fakeChannel("chan-autre-4");
    confessStore.setChannel("g-garde-4", channelConfession.id);
    const msg = fakeMessage(env, { authorId: "u-normal", content: "coucou", channel: autreSalon });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
  });

  await cas("tant qu'aucun salon n'est configuré, aucune suppression", async () => {
    const env = makeEnv("g-garde-5");
    const channel = fakeChannel("chan-garde-5");
    const msg = fakeMessage(env, { authorId: "u-normal", content: "coucou", channel });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
  });

  await cas("une commande !!confess mal utilisée (sans la permission) n'est PAS supprimée par la garde, juste refusée", async () => {
    const env = makeEnv("g-garde-6");
    const channel = fakeChannel("chan-garde-6");
    confessStore.setChannel("g-garde-6", channel.id);
    const msg = fakeMessage(env, { authorId: "u-sans", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
    assert.ok(msg._replies[0]?.includes?.("pas la permission"));
  });

  console.log("\nParcours de participation — jamais de publication automatique :");

  await cas("étape 1 : cliquer ouvre DIRECTEMENT une modale — pas de garçon/fille, pas de MP", async () => {
    const env = makeEnv("g-flow-1");
    const i1 = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1" });
    await handleConfessInteraction(i1);
    assert.strictEqual(i1._modals.length, 1);
    assert.strictEqual(i1._replies.length, 0);
    assert.strictEqual(env.getUser("u-flow-1")._dms.length, 0, "aucun MP envoyé");
  });

  await cas("cliquer deux fois de suite ne bloque JAMAIS (repart à zéro) — bug réel rencontré en production", async () => {
    const env = makeEnv("g-flow-1b");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1b" }));
    const i1b = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1b" });
    await handleConfessInteraction(i1b);
    assert.strictEqual(i1b._modals.length, 1, "une deuxième modale doit s'ouvrir, pas un refus");
    assert.strictEqual(i1b._replies.length, 0);
  });

  await cas("étape 2 : la modale soumise propose de rester anonyme ou non", async () => {
    const env = makeEnv("g-flow-2");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-2" }));
    const soumission = fakeModalSubmit(env, "u-flow-2", "Mon secret");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("rester anonyme"));
  });

  await cas("soumettre la modale SANS avoir cliqué start avant est refusé (étape expirée)", async () => {
    const env = makeEnv("g-flow-3");
    const soumission = fakeModalSubmit(env, "u-flow-3", "Mon secret");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("expiré"));
  });

  await cas("un message vide dans la modale ne fait pas avancer l'étape", async () => {
    const env = makeEnv("g-flow-vide");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-vide" }));
    const soumission = fakeModalSubmit(env, "u-flow-vide", "   ");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("vide"));
  });

  await cas("étape 3 : choisir anonyme MET EN ATTENTE — jamais publié automatiquement", async () => {
    const env = makeEnv("g-flow-6");
    const publicChan = fakeChannel("chan-flow-6");
    confessStore.setChannel("g-flow-6", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-6" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-flow-6", "Baisons eren les amis"));

    const iAnon = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-flow-6" });
    await handleConfessInteraction(iAnon);

    assert.ok(iAnon._updates[0].content.includes("attente de publication"));
    assert.strictEqual(publicChan._envois.length, 0, "RIEN ne doit être publié automatiquement");

    const pending = confessStore.getPending("g-flow-6");
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].texte, "Baisons eren les amis");
    assert.strictEqual(pending[0].anonyme, true);
    assert.strictEqual(pending[0].authorId, "u-flow-6");
  });

  await cas("choisir de ne PAS rester anonyme reste quand même SEULEMENT en attente (pas publié)", async () => {
    const env = makeEnv("g-flow-7");
    const publicChan = fakeChannel("chan-flow-7");
    confessStore.setChannel("g-flow-7", publicChan.id);
    env.guild.channels.cache.set(publicChan.id, publicChan);

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-7" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-flow-7", "message assumé"));
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:anon:non", userId: "u-flow-7" }));

    assert.strictEqual(publicChan._envois.length, 0);
    const pending = confessStore.getPending("g-flow-7");
    assert.strictEqual(pending[0].anonyme, false);
    assert.strictEqual(pending[0].authorTag, "u-flow-7#0001");
  });

  await cas("choisir anonyme/non SANS avoir soumis de message avant est refusé", async () => {
    const env = makeEnv("g-flow-8");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-8" }));
    const i = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-flow-8" });
    await handleConfessInteraction(i);
    assert.ok(i._replies[0].content.includes("expiré"));
  });

  await cas("sans salon configuré, la mise en attente est abandonnée proprement", async () => {
    const env = makeEnv("g-flow-sans-salon");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-ss" }));
    await handleConfessInteraction(fakeModalSubmit(env, "u-flow-ss", "un message"));
    const iAnon = fakeInteraction(env, { customId: "confess:anon:oui", userId: "u-flow-ss" });
    await handleConfessInteraction(iAnon);
    assert.ok(iAnon._updates[0].content.includes("n'est plus configuré"));
    assert.strictEqual(confessStore.getPending("g-flow-sans-salon").length, 0);
  });

  console.log("\nGestion INTÉGRÉE au panneau public (transforme le VRAI message, réservée à la permission) :");

  await cas("sans la permission, un clic est refusé (éphémère) et NE MODIFIE PAS le panneau", async () => {
    const env = makeEnv("g-gerer-secu");
    confessStore.setChannel("g-gerer-secu", "chan-x");
    for (const customId of ["confess:gerer:ouvrir", "confess:gerer:choisir", "confess:gerer:publier:001", "confess:gerer:refuser:001", "confess:gerer:retour", "confess:gerer:fermer"]) {
      const i = fakeInteraction(env, { customId, userId: "u-intrus", values: ["001"] });
      await handleConfessInteraction(i);
      assert.strictEqual(i._replies.length, 1, customId);
      assert.ok(i._replies[0].content.includes("pas la permission"), customId);
      assert.ok(i._replies[0].flags, "doit être éphémère");
      assert.strictEqual(i._updates.length, 0, `${customId} ne doit JAMAIS transformer le panneau`);
    }
  });

  await cas("avec la permission, \"Gérer les confessions\" transforme le VRAI panneau (update, pas reply)", async () => {
    const env = makeEnv("g-ouvrir-oui");
    confessStore.setChannel("g-ouvrir-oui", "chan-x");
    confessStore.addPending("g-ouvrir-oui", { texte: "en attente", anonyme: true, authorId: "u-y", authorTag: "u-y#0001" });
    const i = fakeInteraction(env, { customId: "confess:gerer:ouvrir", userId: "u-staff", permissionKey: PERM_GERER });
    await handleConfessInteraction(i);
    assert.strictEqual(i._replies.length, 0, "aucune réponse séparée — c'est le panneau qui se transforme");
    assert.strictEqual(i._updates.length, 1);
    const menu = menuDuPanneau(partiesJSON(i._updates[0])[0]);
    assert.ok(menu.options.some((o) => o.label.includes("Confession #")));
  });

  await cas('avoir la permission via un RÔLE (pas juste un octroi direct) suffit, comme "&panel > Permissions"', async () => {
    const env = makeEnv("g-gerer-role");
    permStore.setRoleGrants("g-gerer-role", "role-staff", [PERM_GERER]);
    confessStore.setChannel("g-gerer-role", "chan-x");
    const i = fakeInteraction(env, { customId: "confess:gerer:ouvrir", userId: "u-staff" });
    i.member.roles.cache.set("role-staff", { id: "role-staff" });
    await handleConfessInteraction(i);
    assert.strictEqual(i._updates.length, 1, "la permission accordée au rôle doit suffire");
  });

  await cas("sélectionner une confession affiche son contenu, SANS AUCUNE information sur l'auteur", async () => {
    const env = makeEnv("g-gerer-1");
    confessStore.setChannel("g-gerer-1", "chan-x");
    const id = confessStore.addPending("g-gerer-1", { texte: "Un secret bien gardé", anonyme: true, authorId: "u-auteur-secret", authorTag: "PseudoSecret#1234" });

    const i = fakeInteraction(env, { customId: "confess:gerer:choisir", userId: "u-staff", values: [id], permissionKey: PERM_GERER });
    await handleConfessInteraction(i);

    const conteneur = partiesJSON(i._updates[0])[0];
    const texte = conteneur.components.map((c) => c.content).join("\n");
    assert.ok(texte.includes("Un secret bien gardé"), texte);
    assert.ok(texte.includes("Confession #" + id), texte);
    assert.ok(texte.includes("Reste anonyme"), texte);
    assert.ok(!texte.includes("u-auteur-secret"), "l'ID de l'auteur ne doit JAMAIS apparaître");
    assert.ok(!texte.includes("PseudoSecret"), "le pseudo de l'auteur ne doit JAMAIS apparaître, même avec la permission");
    assert.ok(!texte.toLowerCase().includes("auteur"), "même le mot \"Auteur\" ne doit plus apparaître");
    assert.deepStrictEqual(boutonsGestion(conteneur), ["Publier", "Refuser", "Retour", "Fermer"]);
  });

  await cas("Publier : envoie la confession dans le salon SANS révéler l'auteur, la retire de la liste, AUCUN MP envoyé", async () => {
    const env = makeEnv("g-gerer-2");
    const publicChan = fakeChannel("chan-gerer-2");
    env.guild.channels.cache.set(publicChan.id, publicChan);
    confessStore.setChannel("g-gerer-2", publicChan.id);
    const auteur = env.getUser("u-auteur-2");
    const id = confessStore.addPending("g-gerer-2", { texte: "Message anonyme à publier", anonyme: true, authorId: "u-auteur-2", authorTag: "u-auteur-2#0001" });

    const i = fakeInteraction(env, { customId: `confess:gerer:publier:${id}`, userId: "u-staff", permissionKey: PERM_GERER });
    await handleConfessInteraction(i);

    assert.strictEqual(publicChan._envois.length, 1);
    assert.strictEqual(publicChan._envois[0].payload.files[0].description, "Message anonyme à publier");
    const partiesPubliees = partiesJSON(publicChan._envois[0].payload);
    assert.ok(!partiesPubliees.some((c) => c.content?.includes("u-auteur-2")), "l'auteur ne doit JAMAIS apparaître publiquement");

    assert.strictEqual(confessStore.getPending("g-gerer-2").length, 0, "retirée de la file après publication");
    assert.strictEqual(auteur._dms.length, 0, "aucun MP envoyé — demande explicite");

    const texte = partiesJSON(i._updates[0])[0].components.map((c) => c.content).join("\n");
    assert.ok(texte.includes("Aucune confession en attente"));
  });

  await cas("Refuser : ne publie rien, retire de la liste, AUCUN MP envoyé", async () => {
    const env = makeEnv("g-gerer-3");
    const publicChan = fakeChannel("chan-gerer-3");
    env.guild.channels.cache.set(publicChan.id, publicChan);
    confessStore.setChannel("g-gerer-3", publicChan.id);
    const auteur = env.getUser("u-auteur-3");
    const id = confessStore.addPending("g-gerer-3", { texte: "Message refusé", anonyme: false, authorId: "u-auteur-3", authorTag: "u-auteur-3#0001" });

    const i = fakeInteraction(env, { customId: `confess:gerer:refuser:${id}`, userId: "u-staff", permissionKey: PERM_GERER });
    await handleConfessInteraction(i);

    assert.strictEqual(publicChan._envois.length, 0, "rien ne doit être publié");
    assert.strictEqual(confessStore.getPending("g-gerer-3").length, 0);
    assert.strictEqual(auteur._dms.length, 0, "aucun MP envoyé — demande explicite");
  });

  await cas("publier/refuser une confession déjà traitée (ou inconnue) ne plante pas, revient à la liste", async () => {
    const env = makeEnv("g-gerer-4");
    confessStore.setChannel("g-gerer-4", "chan-x");
    const i = fakeInteraction(env, { customId: "confess:gerer:publier:999", userId: "u-staff", permissionKey: PERM_GERER });
    await handleConfessInteraction(i);
    const texte = partiesJSON(i._updates[0])[0].components.map((c) => c.content).join("\n");
    assert.ok(texte.includes("Aucune confession en attente"));
  });

  await cas("Retour revient à la liste des confessions en attente", async () => {
    const env = makeEnv("g-gerer-5");
    confessStore.setChannel("g-gerer-5", "chan-x");
    confessStore.addPending("g-gerer-5", { texte: "toujours là", anonyme: true, authorId: "u-x", authorTag: "u-x#0001" });
    const i = fakeInteraction(env, { customId: "confess:gerer:retour", userId: "u-staff", permissionKey: PERM_GERER });
    await handleConfessInteraction(i);
    const conteneur = partiesJSON(i._updates[0])[0];
    const menu = menuDuPanneau(conteneur);
    assert.ok(menu, "un menu déroulant doit être présent");
    assert.ok(menu.options.some((o) => o.label.includes("Confession #")), JSON.stringify(menu.options));
  });

  await cas("Fermer revient au panneau de base (plus de zone de gestion visible)", async () => {
    const env = makeEnv("g-gerer-6");
    confessStore.setChannel("g-gerer-6", "chan-x");
    const i = fakeInteraction(env, { customId: "confess:gerer:fermer", userId: "u-staff", permissionKey: PERM_GERER });
    await handleConfessInteraction(i);
    const conteneur = partiesJSON(i._updates[0])[0];
    assert.ok(!boutonsGestion(conteneur), "aucun bouton de gestion — retour au panneau de base");
    const texte = conteneur.components.map((c) => c.content).join("\n");
    assert.ok(!texte.includes("Messages anonymes en attente"));
    const rangee = conteneur.components.find((c) => c.type === 1);
    assert.deepStrictEqual(rangee.components.map((b) => b.label), ["Je souhaite participer", "Gérer les confessions"]);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
