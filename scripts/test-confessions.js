/**
 * Vérifie "!!confess" (utils/confessions.js) — refonte en profondeur :
 *
 *  - "!!confess setup" installe SEULEMENT le panneau public.
 *  - "!!confess role @rôle" configure le rôle dispensé du blocage d'écriture.
 *  - "!!confess" (seul) fait de son auteur LE gestionnaire de la session —
 *    lui seul peut ensuite publier/refuser les confessions en attente.
 *  - Le salon de confession est protégé : tout message qui n'est pas du
 *    gestionnaire, d'un administrateur, d'un membre du rôle "perm confess"
 *    ou du bot est supprimé instantanément.
 *  - Une confession envoyée par un participant n'est JAMAIS publiée
 *    automatiquement : elle rejoint une file d'attente que seul le
 *    gestionnaire consulte (menu déroulant), avant de choisir Publier ou
 *    Refuser — l'ancien salon de validation staff a été retiré, remplacé
 *    par cette interface.
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
function fakeMessage(env, { authorId, content, channel, isAdmin = false, roleIds = [], mentionedRole, bot = false }) {
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
      roles: { cache: new Collection(roleIds.map((id) => [id, { id }])) },
      permissions: { has: () => isAdmin },
    },
    mentions: { roles: { first: () => mentionedRole || null } },
    reply: async (p) => replies.push(p),
    delete: async () => deleted.push(true),
    _replies: replies,
    _deleted: deleted,
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

  console.log("\n!!confess setup :");

  await cas("sans channels.manage, setup est refusé", async () => {
    const env = makeEnv("g-setup-non");
    const channel = fakeChannel("chan-setup-non");
    const msg1 = fakeMessage(env, { authorId: "u-sans", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, msg1);
    assert.ok(msg1._replies[0]?.includes?.("pas la permission"));
  });

  await cas('"!!confess setup" poste la carte "Confesse-toi" dans un cadre gris par défaut, avec ses 2 boutons', async () => {
    permStore.grantToUser("g-setup-ok", "u-admin", "channels.manage");
    const env = makeEnv("g-setup-ok");
    const channel = fakeChannel("chan-public");
    const msg = fakeMessage(env, { authorId: "u-admin", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, msg);

    assert.strictEqual(confessStore.getConfig("g-setup-ok").channelId, "chan-public");
    assert.strictEqual(channel._envois.length, 1);
    const payload = channel._envois[0].payload;
    assert.strictEqual(payload.files?.length, 1, "doit joindre l'image de la carte visuelle");
    const parties = partiesJSON(payload);
    const conteneurs = parties.filter((c) => c.type === 17);
    assert.strictEqual(conteneurs.length, 1, "un seul ContainerBuilder regroupant TOUT, image comprise");
    assert.ok(conteneurs[0].accent_color === undefined || conteneurs[0].accent_color === null, "pas de couleur d'accent — gris par défaut");
    const interieur = conteneurs[0].components;
    assert.ok(interieur.some((c) => c.type === 12), "l'image du dégradé doit être DANS le cadre, pas au-dessus");
    assert.ok(interieur.some((c) => c.type === 14), "un vrai SeparatorBuilder doit séparer les étapes du disclaimer");
    const texte = interieur.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Comment participer"), texte);
    assert.ok(texte.includes("fenêtre qui s'ouvre"), "le parcours décrit ne doit plus mentionner de MP");
    assert.ok(!texte.includes("garçon"), "plus d'étape garçon/fille dans le parcours décrit");
    const rangeeBoutons = interieur.find((c) => c.type === 1);
    const labels = rangeeBoutons.components.map((b) => b.label);
    assert.deepStrictEqual(labels, ["Je souhaite participer", "Gérer les notifications"]);
  });

  console.log("\n!!confess role :");

  await cas("sans channels.manage, role est refusé", async () => {
    const env = makeEnv("g-role-non");
    const msg = fakeMessage(env, { authorId: "u-sans", content: "!!confess role", mentionedRole: { id: "r1" } });
    await handleConfessTextCommand(null, msg);
    assert.ok(msg._replies[0]?.includes?.("pas la permission"));
    assert.strictEqual(confessStore.getConfig("g-role-non").permRoleId, null);
  });

  await cas('"!!confess role @rôle" enregistre le rôle dispensé du blocage', async () => {
    permStore.grantToUser("g-role-ok", "u-admin", "channels.manage");
    const env = makeEnv("g-role-ok");
    const role = { id: "role-confess", toString: () => "@perm-confess" };
    const msg = fakeMessage(env, { authorId: "u-admin", content: "!!confess role @perm-confess", mentionedRole: role });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(confessStore.getConfig("g-role-ok").permRoleId, "role-confess");
    assert.ok(msg._replies[0]?.includes?.("écrire dans le salon"));
  });

  await cas("sans rôle mentionné, un message d'aide est renvoyé", async () => {
    permStore.grantToUser("g-role-vide", "u-admin", "channels.manage");
    const env = makeEnv("g-role-vide");
    const msg = fakeMessage(env, { authorId: "u-admin", content: "!!confess role" });
    await handleConfessTextCommand(null, msg);
    assert.ok(msg._replies[0]?.includes?.("Indique un rôle"));
  });

  console.log("\n!!confess (session de gestion) :");

  await cas("sans channels.manage, ouvrir une session est refusé", async () => {
    const env = makeEnv("g-session-non");
    const msg = fakeMessage(env, { authorId: "u-sans", content: "!!confess" });
    await handleConfessTextCommand(null, msg);
    assert.ok(msg._replies[0]?.includes?.("pas la permission"));
    assert.strictEqual(confessStore.getConfig("g-session-non").managerId, null);
  });

  await cas('"!!confess" fait de son auteur le gestionnaire et poste la liste (vide)', async () => {
    permStore.grantToUser("g-session-ok", "u-manager", "channels.manage");
    const env = makeEnv("g-session-ok");
    const channel = fakeChannel("chan-session");
    const msg = fakeMessage(env, { authorId: "u-manager", content: "!!confess", channel });
    await handleConfessTextCommand(null, msg);

    assert.strictEqual(confessStore.getConfig("g-session-ok").managerId, "u-manager");
    assert.strictEqual(channel._envois.length, 1);
    const texte = partiesJSON(channel._envois[0].payload)[0].components.map((c) => c.content).join("\n");
    assert.ok(texte.includes("Aucune confession en attente"), texte);
  });

  await cas('relancer "!!confess" remplace le gestionnaire précédent', async () => {
    permStore.grantToUser("g-session-remplace", "u-manager-1", "channels.manage");
    permStore.grantToUser("g-session-remplace", "u-manager-2", "channels.manage");
    const env = makeEnv("g-session-remplace");
    const channel = fakeChannel("chan-remplace");
    await handleConfessTextCommand(null, fakeMessage(env, { authorId: "u-manager-1", content: "!!confess", channel }));
    assert.strictEqual(confessStore.getConfig("g-session-remplace").managerId, "u-manager-1");
    await handleConfessTextCommand(null, fakeMessage(env, { authorId: "u-manager-2", content: "!!confess", channel }));
    assert.strictEqual(confessStore.getConfig("g-session-remplace").managerId, "u-manager-2");
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

  await cas("le gestionnaire de la session peut écrire", async () => {
    const env = makeEnv("g-garde-2");
    const channel = fakeChannel("chan-garde-2");
    confessStore.setChannel("g-garde-2", channel.id);
    confessStore.setManager("g-garde-2", "u-manager");
    const msg = fakeMessage(env, { authorId: "u-manager", content: "coucou", channel });
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

  await cas('un membre avec le rôle "perm confess" peut écrire', async () => {
    const env = makeEnv("g-garde-4");
    const channel = fakeChannel("chan-garde-4");
    confessStore.setChannel("g-garde-4", channel.id);
    confessStore.setPermRole("g-garde-4", "role-perm");
    const msg = fakeMessage(env, { authorId: "u-perm", content: "coucou", channel, roleIds: ["role-perm"] });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
  });

  await cas("un membre avec channels.manage (configuration) peut aussi écrire", async () => {
    permStore.grantToUser("g-garde-5", "u-config", "channels.manage");
    const env = makeEnv("g-garde-5");
    const channel = fakeChannel("chan-garde-5");
    confessStore.setChannel("g-garde-5", channel.id);
    const msg = fakeMessage(env, { authorId: "u-config", content: "coucou", channel });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
  });

  await cas("un message ailleurs que dans le salon de confession n'est jamais supprimé", async () => {
    const env = makeEnv("g-garde-6");
    const channelConfession = fakeChannel("chan-garde-6");
    const autreSalon = fakeChannel("chan-autre-6");
    confessStore.setChannel("g-garde-6", channelConfession.id);
    const msg = fakeMessage(env, { authorId: "u-normal", content: "coucou", channel: autreSalon });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
  });

  await cas("tant qu'aucun salon n'est configuré, aucune suppression", async () => {
    const env = makeEnv("g-garde-7");
    const channel = fakeChannel("chan-garde-7");
    const msg = fakeMessage(env, { authorId: "u-normal", content: "coucou", channel });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._deleted.length, 0);
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

  await cas("cliquer deux fois de suite est refusé (une confession déjà en cours)", async () => {
    const env = makeEnv("g-flow-1b");
    const i1a = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1b" });
    await handleConfessInteraction(i1a);
    const i1b = fakeInteraction(env, { customId: "confess:start", userId: "u-flow-1b" });
    await handleConfessInteraction(i1b);
    assert.ok(i1b._replies[0].content.includes("déjà une confession"));
  });

  await cas("étape 2 : la modale soumise propose de rester anonyme ou non", async () => {
    const env = makeEnv("g-flow-4");
    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:start", userId: "u-flow-4" }));
    const soumission = fakeModalSubmit(env, "u-flow-4", "Mon secret");
    await handleConfessInteraction(soumission);
    assert.ok(soumission._replies[0].content.includes("rester anonyme"));
  });

  await cas("soumettre la modale SANS avoir cliqué start avant est refusé (étape expirée)", async () => {
    const env = makeEnv("g-flow-5");
    const soumission = fakeModalSubmit(env, "u-flow-5", "Mon secret");
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

  await cas("choisir de ne PAS rester anonyme enregistre quand même le pseudo SEULEMENT en attente (pas publié)", async () => {
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

  console.log("\nInterface du gestionnaire :");

  await cas("un utilisateur qui n'est PAS le gestionnaire reçoit un refus éphémère (menu et boutons)", async () => {
    const env = makeEnv("g-gerer-secu");
    confessStore.setManager("g-gerer-secu", "u-vrai-gestionnaire");
    for (const customId of ["confess:gerer:choisir", "confess:gerer:publier:001", "confess:gerer:refuser:001", "confess:gerer:retour", "confess:gerer:fermer"]) {
      const i = fakeInteraction(env, { customId, userId: "u-intrus", values: ["001"] });
      await handleConfessInteraction(i);
      assert.strictEqual(i._replies.length, 1, customId);
      assert.ok(i._replies[0].content.includes("pas le gestionnaire"), customId);
      assert.ok(i._replies[0].flags, "doit être éphémère");
      assert.strictEqual(i._updates.length, 0, customId);
    }
  });

  await cas("sélectionner une confession dans le menu affiche son contenu complet", async () => {
    const env = makeEnv("g-gerer-1");
    confessStore.setManager("g-gerer-1", "u-gestionnaire");
    const id = confessStore.addPending("g-gerer-1", { texte: "Un secret bien gardé", anonyme: true, authorId: "u-auteur", authorTag: "u-auteur#0001" });

    const i = fakeInteraction(env, { customId: "confess:gerer:choisir", userId: "u-gestionnaire", values: [id] });
    await handleConfessInteraction(i);

    const parties = partiesJSON(i._updates[0]);
    const texte = parties[0].components.map((c) => c.content).join("\n");
    assert.ok(texte.includes("Un secret bien gardé"), texte);
    assert.ok(texte.includes("u-auteur#0001"), texte);
    assert.ok(texte.includes("Confession #" + id), texte);
    const boutons = parties[0].components.find((c) => c.type === 1).components.map((b) => b.label);
    assert.deepStrictEqual(boutons, ["Publier", "Refuser", "Retour", "Fermer"]);
  });

  await cas("Publier : envoie la confession dans le salon SANS révéler l'auteur, la retire de la liste, prévient l'auteur", async () => {
    const env = makeEnv("g-gerer-2");
    const publicChan = fakeChannel("chan-gerer-2");
    env.guild.channels.cache.set(publicChan.id, publicChan);
    confessStore.setChannel("g-gerer-2", publicChan.id);
    confessStore.setManager("g-gerer-2", "u-gestionnaire");
    const auteurAvant = env.getUser("u-auteur-2"); // enregistré AVANT : client.users.fetch doit le retrouver
    const id = confessStore.addPending("g-gerer-2", { texte: "Message anonyme à publier", anonyme: true, authorId: "u-auteur-2", authorTag: "u-auteur-2#0001" });

    const i = fakeInteraction(env, { customId: `confess:gerer:publier:${id}`, userId: "u-gestionnaire" });
    await handleConfessInteraction(i);

    assert.strictEqual(publicChan._envois.length, 1);
    assert.strictEqual(publicChan._envois[0].payload.files[0].description, "Message anonyme à publier");
    const partiesPubliees = partiesJSON(publicChan._envois[0].payload);
    assert.ok(!partiesPubliees.some((c) => c.content?.includes("u-auteur-2")), "l'auteur ne doit JAMAIS apparaître publiquement");

    assert.strictEqual(confessStore.getPending("g-gerer-2").length, 0, "retirée de la file après publication");

    assert.ok(auteurAvant._dms.some((m) => m.includes("publiée")));

    // Retour à la liste (désormais vide), pas un message brut.
    const parties = partiesJSON(i._updates[0]);
    assert.ok(parties[0].components.map((c) => c.content).join("\n").includes("Aucune confession en attente"));
  });

  await cas("Refuser : ne publie rien, retire de la liste, prévient l'auteur", async () => {
    const env = makeEnv("g-gerer-3");
    const publicChan = fakeChannel("chan-gerer-3");
    env.guild.channels.cache.set(publicChan.id, publicChan);
    confessStore.setChannel("g-gerer-3", publicChan.id);
    confessStore.setManager("g-gerer-3", "u-gestionnaire");
    const auteurAvant = env.getUser("u-auteur-3"); // enregistré AVANT : client.users.fetch doit le retrouver
    const id = confessStore.addPending("g-gerer-3", { texte: "Message refusé", anonyme: false, authorId: "u-auteur-3", authorTag: "u-auteur-3#0001" });

    const i = fakeInteraction(env, { customId: `confess:gerer:refuser:${id}`, userId: "u-gestionnaire" });
    await handleConfessInteraction(i);

    assert.strictEqual(publicChan._envois.length, 0, "rien ne doit être publié");
    assert.strictEqual(confessStore.getPending("g-gerer-3").length, 0);
    assert.ok(auteurAvant._dms.some((m) => m.includes("pas été retenue")));
  });

  await cas("publier/refuser une confession déjà traitée (ou inconnue) ne plante pas, revient à la liste", async () => {
    const env = makeEnv("g-gerer-4");
    confessStore.setManager("g-gerer-4", "u-gestionnaire");
    const i = fakeInteraction(env, { customId: "confess:gerer:publier:999", userId: "u-gestionnaire" });
    await handleConfessInteraction(i);
    const texte = partiesJSON(i._updates[0])[0].components.map((c) => c.content).join("\n");
    assert.ok(texte.includes("Aucune confession en attente"));
  });

  await cas("Retour revient à la liste des confessions en attente", async () => {
    const env = makeEnv("g-gerer-5");
    confessStore.setManager("g-gerer-5", "u-gestionnaire");
    confessStore.addPending("g-gerer-5", { texte: "toujours là", anonyme: true, authorId: "u-x", authorTag: "u-x#0001" });
    const i = fakeInteraction(env, { customId: "confess:gerer:retour", userId: "u-gestionnaire" });
    await handleConfessInteraction(i);
    const conteneur = partiesJSON(i._updates[0])[0];
    const menu = conteneur.components.find((c) => c.type === 1)?.components[0];
    assert.ok(menu, "un menu déroulant doit être présent");
    assert.ok(menu.options.some((o) => o.label.includes("Confession #")), JSON.stringify(menu.options));
  });

  await cas("Fermer affiche un panneau fermé, sans boutons ni menu", async () => {
    const env = makeEnv("g-gerer-6");
    confessStore.setManager("g-gerer-6", "u-gestionnaire");
    const i = fakeInteraction(env, { customId: "confess:gerer:fermer", userId: "u-gestionnaire" });
    await handleConfessInteraction(i);
    const parties = partiesJSON(i._updates[0]);
    assert.ok(!parties.some((c) => c.type === 1), "aucun bouton");
    assert.ok(parties[0].components.some((c) => c.content?.includes("fermé")));
  });

  console.log("\nNotifications :");

  await cas('"Gérer les notifications" bascule ON puis OFF, en éphémère', async () => {
    const env = makeEnv("g-notif");
    const i1 = fakeInteraction(env, { customId: "confess:notif", userId: "u-notif-1" });
    await handleConfessInteraction(i1);
    assert.ok(i1._replies[0].content.includes("🔔"));
    assert.ok(i1._replies[0].flags);

    const i2 = fakeInteraction(env, { customId: "confess:notif", userId: "u-notif-1" });
    await handleConfessInteraction(i2);
    assert.ok(i2._replies[0].content.includes("🔕"));
  });

  await cas("les personnes inscrites reçoivent un MP à la publication, pas l'auteur lui-même", async () => {
    const env = makeEnv("g-notif-pub");
    const publicChan = fakeChannel("chan-notif-pub");
    env.guild.channels.cache.set(publicChan.id, publicChan);
    confessStore.setChannel("g-notif-pub", publicChan.id);
    confessStore.setManager("g-notif-pub", "u-gestionnaire");

    await handleConfessInteraction(fakeInteraction(env, { customId: "confess:notif", userId: "u-notif-abo" }));
    const id = confessStore.addPending("g-notif-pub", { texte: "coucou", anonyme: true, authorId: "u-notif-auteur", authorTag: "u-notif-auteur#0001" });
    await handleConfessInteraction(fakeInteraction(env, { customId: `confess:gerer:publier:${id}`, userId: "u-gestionnaire" }));

    const abonne = env.getUser("u-notif-abo");
    assert.ok(abonne._dms.some((m) => m.includes("Nouvelle confession publiée")));
    const auteur = env.getUser("u-notif-auteur");
    assert.ok(!auteur._dms.some((m) => m.includes("Nouvelle confession publiée")), "l'auteur ne doit pas recevoir la notif générique en plus de la sienne");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
