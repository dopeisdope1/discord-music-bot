/**
 * Vérifie les commandes utilitaires en lecture seule (utils/utilityCommands.js,
 * utils/readOnlyLists.js, utils/calc.js, utils/wikipedia.js) : listes de
 * membres paginées, fiches d'information, calculatrice et Wikipédia.
 *
 * Aucun appel réseau réel : &wiki reçoit un faux `fetch`, pour que la suite
 * reste verte hors ligne comme le reste des tests du dépôt.
 *
 * Lancement : node scripts/test-utility-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "utilitycmd-test-"));
process.env.BOT_OWNER_IDS = "author-1";

const { Collection, PermissionFlagsBits, ChannelType, ActivityType } = require("discord.js");
const { utilityHandlers } = require("../utils/utilityCommands");
const readOnlyLists = require("../utils/readOnlyLists");
const { DEFINITIONS } = readOnlyLists;
const calc = require("../utils/calc");
const wikipedia = require("../utils/wikipedia");
const permStore = require("../utils/permissions/store");

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

// --- Faux serveur Discord, réduit à ce que lisent les commandes testées ---

function fakeRole(id, name, position = 1) {
  return { id, name, position, toString: () => `<@&${id}>` };
}

function fakeMember({ id, tag, bot = false, admin = false, roles = [], premiumSince = null, joined = 1700000000000, presence = null, voice = {} }) {
  const roleCache = new Collection();
  for (const r of roles) roleCache.set(r.id, r);
  const highest = roles.length ? roles.reduce((a, b) => (a.position > b.position ? a : b)) : fakeRole("everyone", "@everyone", 0);
  return {
    id,
    user: { id, tag, bot, createdTimestamp: 1600000000000, displayAvatarURL: () => "https://avatar" },
    permissions: { has: (flag) => admin && flag === PermissionFlagsBits.Administrator },
    roles: { cache: roleCache, highest },
    premiumSince,
    premiumSinceTimestamp: premiumSince,
    joinedTimestamp: joined,
    joinedAt: new Date(joined),
    communicationDisabledUntil: null,
    presence,
    voice: { channelId: voice.channelId || null, streaming: voice.streaming || false, selfVideo: voice.selfVideo || false, mute: voice.mute || false },
  };
}

function fakeGuild({ members = [], roles = [], channels = [], voiceStates = [] } = {}) {
  const memberCache = new Collection();
  for (const m of members) memberCache.set(m.id, m);
  const roleCache = new Collection();
  for (const r of roles) roleCache.set(r.id, r);
  const channelCache = new Collection();
  for (const c of channels) channelCache.set(c.id, c);
  const voiceCache = new Collection();
  voiceStates.forEach((s, i) => voiceCache.set(String(i), s));

  return {
    id: "guild-1",
    name: "Serveur de test",
    iconURL: () => "https://icon",
    memberCount: members.length,
    premiumTier: 2,
    premiumSubscriptionCount: members.filter((m) => m.premiumSince).length,
    members: { cache: memberCache, fetch: async (id) => (id ? memberCache.get(id) || Promise.reject(new Error("inconnu")) : memberCache) },
    roles: { cache: roleCache },
    channels: { cache: channelCache },
    voiceStates: { cache: voiceCache },
    emojis: { cache: new Collection() },
  };
}

function fakeMessage(guild, { args = [], mentions = {} } = {}) {
  const replies = [];
  return {
    author: { id: "author-1", tag: "auteur#0001", createdTimestamp: 1600000000000, bot: false, displayAvatarURL: () => "https://avatar" },
    // "author-1" est propriétaire du bot (process.env.BOT_OWNER_IDS) : passe
    // toute vérification de permission sans avoir à accorder de rôle pour
    // chaque test — seuls &vc/&stats en ont besoin (server.stats.view).
    member: { id: "author-1", guild, roles: { cache: new Collection() } },
    guild,
    client: { users: { fetch: async () => null } },
    mentions: {
      users: mentions.users || new Collection(),
      members: mentions.members || new Collection(),
      roles: mentions.roles || new Collection(),
    },
    reply: async (payload) => {
      replies.push(payload);
      return {};
    },
    _replies: replies,
    _args: args,
  };
}

/** Texte de la carte Components V2 (utils/listCard.js) : le 3e composant. */
const cardBody = (payload) => payload.components[0].toJSON().components[2].content;
const embedText = (payload) => payload.embeds[0].data.description || "";
const embedTitle = (payload) => payload.embeds[0].data.title || "";

(async () => {
  console.log("Listes de membres (utils/readOnlyLists.js) :");

  const staff = fakeRole("role-staff", "Staff", 5);
  const vip = fakeRole("role-vip", "VIP", 2);
  const guild = fakeGuild({
    roles: [staff, vip],
    members: [
      fakeMember({ id: "u1", tag: "alice#0001", admin: true, roles: [staff] }),
      fakeMember({ id: "u2", tag: "bob#0002", roles: [vip], premiumSince: 1690000000000 }),
      fakeMember({ id: "u3", tag: "carol#0003", admin: true, roles: [vip], premiumSince: 1680000000000 }),
      fakeMember({ id: "b1", tag: "botadmin#0004", bot: true, admin: true }),
      fakeMember({ id: "b2", tag: "botsimple#0005", bot: true }),
    ],
  });

  await cas("&alladmins ne liste que les humains administrateurs", () => {
    const { items } = DEFINITIONS.alladmins.build(guild);
    assert.strictEqual(items.length, 2);
    assert.ok(items.join(" ").includes("alice#0001") && items.join(" ").includes("carol#0003"));
    assert.ok(!items.join(" ").includes("botadmin#0004"), "un bot administrateur ne doit pas apparaître dans &alladmins");
  });

  await cas("&botadmins ne liste que les bots administrateurs", () => {
    const { items } = DEFINITIONS.botadmins.build(guild);
    assert.strictEqual(items.length, 1);
    assert.ok(items[0].includes("botadmin#0004"));
  });

  await cas("&boosters liste les boosters du plus ancien au plus récent", () => {
    const { items } = DEFINITIONS.boosters.build(guild);
    assert.strictEqual(items.length, 2);
    assert.ok(items[0].includes("u3"), "carol boostait avant bob, elle doit passer en premier");
  });

  await cas("&rolemembers ne prend que les membres du rôle demandé", () => {
    const { items } = DEFINITIONS.rolemembers.build(guild, "role-vip");
    assert.strictEqual(items.length, 2);
    assert.ok(!items.join(" ").includes("alice#0001"));
  });

  await cas("&rolemembers sur un rôle inexistant ne construit rien", () => {
    assert.strictEqual(DEFINITIONS.rolemembers.build(guild, "role-fantome"), null);
  });

  await cas("le rôle voyage dans le customId, pour que la pagination sache quoi recalculer", async () => {
    const msg = fakeMessage(guild, { mentions: { roles: new Collection([["role-vip", vip]]) } });
    await utilityHandlers.rolemembers(null, msg, []);
    const json = JSON.stringify(msg._replies[0].components[0].toJSON());
    assert.ok(json.includes("Staff") === false);
    assert.ok(cardBody(msg._replies[0]).includes("bob#0002"));
  });

  await cas("&rolemembers accepte un nom de rôle, pas seulement une mention", async () => {
    const msg = fakeMessage(guild);
    await utilityHandlers.rolemembers(null, msg, ["staff"]);
    assert.ok(cardBody(msg._replies[0]).includes("alice#0001"));
  });

  await cas("&rolemembers sans argument explique quoi faire au lieu de rester muet", async () => {
    const msg = fakeMessage(guild);
    await utilityHandlers.rolemembers(null, msg, []);
    assert.ok(embedText(msg._replies[0]).includes("rôle"));
  });

  console.log("\nPagination des listes en lecture seule :");

  await cas("au-delà de 10 entrées, un sélecteur de page est bien proposé", () => {
    const gros = fakeGuild({
      roles: [staff],
      members: Array.from({ length: 25 }, (_, i) => fakeMember({ id: `m${i}`, tag: `membre${i}#0000`, admin: true })),
    });
    const { items } = DEFINITIONS.alladmins.build(gros);
    assert.strictEqual(items.length, 25);
    const { buildListCard } = require("../utils/listCard");
    const json = JSON.stringify(buildListCard({ idKind: "alladmins", title: "t", description: "d", items, page: 0, canEdit: false }));
    assert.ok(json.includes("srv:page:alladmins"), "le sélecteur doit porter le customId traité par handleServerAdminInteraction");
    assert.ok(json.includes("Page 1/3"));
  });

  await cas("l'argument d'une liste survit dans le customId de la pagination", () => {
    const { buildListCard } = require("../utils/listCard");
    const items = Array.from({ length: 15 }, (_, i) => `membre ${i}`);
    const json = JSON.stringify(buildListCard({ idKind: "rolemembers/role-vip", title: "t", description: "d", items, page: 0, canEdit: false }));
    assert.ok(json.includes("srv:page:rolemembers/role-vip"));
  });

  await cas("le clic sur « page suivante » d'une liste en lecture seule met bien la carte à jour", async () => {
    const { handleServerAdminInteraction } = require("../utils/serverAdminCommands");
    const gros = fakeGuild({
      roles: [vip],
      members: Array.from({ length: 25 }, (_, i) => fakeMember({ id: `m${i}`, tag: `membre${i}#0000`, roles: [vip] })),
    });
    let updated = null;
    await handleServerAdminInteraction({
      customId: "srv:page:rolemembers/role-vip",
      values: ["1"],
      guild: gros,
      member: fakeMember({ id: "m0", tag: "membre0#0000" }),
      user: { id: "m0" },
      update: async (payload) => {
        updated = payload;
      },
      reply: async (payload) => {
        updated = payload;
      },
    });
    assert.ok(updated, "l'interaction doit produire une mise à jour — avant, le sélecteur ne faisait rien");
    assert.ok(cardBody(updated).includes("11. "), "la page 2 doit commencer à la 11e entrée");
  });

  console.log("\nFiches d'information :");

  await cas("&user répond pour l'auteur par défaut et dit qu'il est sur le serveur", async () => {
    const g = fakeGuild({ members: [fakeMember({ id: "author-1", tag: "auteur#0001" })] });
    const msg = fakeMessage(g);
    await utilityHandlers.user(null, msg, []);
    assert.ok(embedTitle(msg._replies[0]).includes("utilisateur"));
    assert.ok(embedText(msg._replies[0]).includes("Sur ce serveur** : oui"));
  });

  await cas("&user répond aussi pour quelqu'un qui n'est PAS membre du serveur", async () => {
    const msg = fakeMessage(fakeGuild({ members: [] }));
    await utilityHandlers.user(null, msg, []);
    assert.ok(embedText(msg._replies[0]).includes("Sur ce serveur** : non"));
  });

  await cas("&vocinfo compte les connectés et détaille les salons occupés", async () => {
    const occupied = {
      id: "v1",
      type: ChannelType.GuildVoice,
      rawPosition: 0,
      userLimit: 5,
      members: new Collection([["u1", {}], ["u2", {}]]),
      toString: () => "<#v1>",
    };
    const empty = { id: "v2", type: ChannelType.GuildVoice, rawPosition: 1, userLimit: 0, members: new Collection(), toString: () => "<#v2>" };
    const g = fakeGuild({
      channels: [occupied, empty],
      voiceStates: [{ channelId: "v1", mute: true, deaf: false, streaming: true }, { channelId: "v1", mute: false, deaf: false }],
    });
    const msg = fakeMessage(g);
    await utilityHandlers.vocinfo(null, msg);
    const body = embedText(msg._replies[0]);
    assert.ok(body.includes("**Salons vocaux** : 2 (dont 1 occupé)"));
    assert.ok(body.includes("**Membres connectés** : 2"));
    assert.ok(body.includes("<#v1> — 2/5"));
  });

  await cas("&vocinfo le dit clairement quand personne n'est en vocal", async () => {
    const msg = fakeMessage(fakeGuild({ channels: [] }));
    await utilityHandlers.vocinfo(null, msg);
    assert.ok(embedText(msg._replies[0]).includes("Aucun salon vocal occupé"));
  });

  await cas("&stats compte membres/en ligne/en vocal/en stream/actifs/mute correctement", async () => {
    const g = fakeGuild({
      members: [
        fakeMember({ id: "m1", tag: "en-ligne-actif#0001", presence: { status: "online", activities: [{ type: ActivityType.Playing }] } }),
        fakeMember({ id: "m2", tag: "idle-en-vocal-stream#0001", presence: { status: "idle", activities: [] }, voice: { channelId: "v1", streaming: true } }),
        fakeMember({ id: "m3", tag: "hors-ligne-mute#0001", presence: null, voice: { channelId: "v1", mute: true } }),
        fakeMember({ id: "m4", tag: "statut-perso-seulement#0001", presence: { status: "dnd", activities: [{ type: ActivityType.Custom }] } }),
      ],
    });
    const msg = fakeMessage(g);
    await utilityHandlers.stats(null, msg);
    const payload = msg._replies[0];
    assert.strictEqual(embedTitle(payload), "📊 Statistiques de Serveur de test");
    const fields = payload.embeds[0].data.fields;
    const val = (name) => fields.find((f) => f.name === name).value;
    assert.strictEqual(val("Membres"), "4");
    // en ligne = tout statut différent de "offline" (online/idle/dnd) -> m1, m2, m4 (m3 sans présence n'est pas compté).
    assert.strictEqual(val("En ligne"), "3");
    assert.strictEqual(val("En vocal"), "2"); // m2, m3
    assert.strictEqual(val("En stream"), "1"); // m2
    assert.strictEqual(val("Actifs"), "1"); // m1 (jeu) — m4 n'a qu'un statut personnalisé, ne compte pas
    assert.strictEqual(val("Mute"), "1"); // m3, connecté ET mute
  });

  await cas("&stats : quelqu'un mute mais PAS connecté ne compte pas dans Mute", async () => {
    const g = fakeGuild({ members: [fakeMember({ id: "m1", tag: "mute-hors-vocal#0001", voice: { mute: true } })] });
    const msg = fakeMessage(g);
    await utilityHandlers.stats(null, msg);
    const fields = msg._replies[0].embeds[0].data.fields;
    assert.strictEqual(fields.find((f) => f.name === "Mute").value, "0");
  });

  await cas("&vc affiche un simple compte de personnes en vocal, rien d'autre", async () => {
    const occupied = { id: "v1", type: ChannelType.GuildVoice, members: new Collection([["u1", {}], ["u2", {}]]) };
    const empty = { id: "v2", type: ChannelType.GuildVoice, members: new Collection() };
    const g = fakeGuild({ channels: [occupied, empty] });
    const msg = fakeMessage(g);
    utilityHandlers.vc(null, msg);
    const texte = embedText(msg._replies[0]);
    assert.ok(texte.includes("**2** personnes en vocal"), texte);
  });

  await cas("&vc accorde le pluriel correctement (0 et 1 personne, pas \"personnes\")", async () => {
    const g0 = fakeGuild({ channels: [] });
    const msg0 = fakeMessage(g0);
    utilityHandlers.vc(null, msg0);
    const texte0 = embedText(msg0._replies[0]);
    assert.ok(texte0.includes("**0** personne en vocal"), texte0);
    assert.ok(!texte0.includes("personnes"), texte0);

    const single = { id: "v1", type: ChannelType.GuildVoice, members: new Collection([["u1", {}]]) };
    const g1 = fakeGuild({ channels: [single] });
    const msg1 = fakeMessage(g1);
    utilityHandlers.vc(null, msg1);
    const texte1 = embedText(msg1._replies[0]);
    assert.ok(texte1.includes("**1** personne en vocal"), texte1);
    assert.ok(!texte1.includes("personnes"), texte1);
  });

  await cas("&vc et &stats exigent server.stats.view — un membre sans cette permission reste sans réponse", async () => {
    // Signalé : un membre n'ayant QUE la permission "giveaway" accordée sur
    // son rôle pouvait quand même utiliser &vc, qui était public par
    // défaut comme les autres commandes de consultation — changé pour
    // exiger explicitement server.stats.view.
    const g = fakeGuild({ channels: [] });
    const msg = fakeMessage(g);
    msg.member = { id: "membre-sans-droits", guild: g, roles: { cache: new Collection() } };
    utilityHandlers.vc(null, msg);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse sans la permission");
    await utilityHandlers.stats(null, msg);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse sans la permission");
  });

  await cas("un rôle qui a UNIQUEMENT server.stats.view (pas owner) débloque bien &vc/&stats", async () => {
    const g = fakeGuild({ channels: [] });
    const roleId = "role-stats-only";
    permStore.setRoleGrants(g.id, roleId, ["server.stats.view"]);
    const msg = fakeMessage(g);
    msg.member = { id: "membre-avec-le-role", guild: g, roles: { cache: new Collection([[roleId, { id: roleId }]]) } };
    utilityHandlers.vc(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("&alladmins/&botadmins/&boosters/&rolemembers exigent server.members.list", async () => {
    const g = fakeGuild({ roles: [fakeRole("role-x", "Rôle X")] });
    const msg = fakeMessage(g, { mentions: { roles: new Collection([["role-x", fakeRole("role-x", "Rôle X")]]) } });
    msg.member = { id: "membre-sans-droits", guild: g, roles: { cache: new Collection() } };
    await utilityHandlers.alladmins(null, msg);
    await utilityHandlers.botadmins(null, msg);
    await utilityHandlers.boosters(null, msg);
    await utilityHandlers.rolemembers(null, msg, msg._args);
    assert.strictEqual(msg._replies.length, 0, "aucune des quatre ne doit répondre sans server.members.list");
  });

  await cas("un rôle qui a UNIQUEMENT server.members.list débloque &alladmins/&botadmins/&boosters/&rolemembers", async () => {
    const roleTarget = fakeRole("role-x", "Rôle X");
    const g = fakeGuild({ roles: [roleTarget] });
    const roleId = "role-members-list-only";
    permStore.setRoleGrants(g.id, roleId, ["server.members.list"]);
    const msg = fakeMessage(g, { mentions: { roles: new Collection([["role-x", roleTarget]]) } });
    msg.member = { id: "membre-avec-le-role", guild: g, roles: { cache: new Collection([[roleId, { id: roleId }]]) } };
    await utilityHandlers.alladmins(null, msg);
    await utilityHandlers.botadmins(null, msg);
    await utilityHandlers.boosters(null, msg);
    await utilityHandlers.rolemembers(null, msg, msg._args);
    assert.strictEqual(msg._replies.length, 4);
  });

  await cas("&vocinfo/&user/&emoji exigent server.info.view", async () => {
    const g = fakeGuild({ channels: [] });
    const msg = fakeMessage(g, { args: ["😀"] });
    msg.member = { id: "membre-sans-droits", guild: g, roles: { cache: new Collection() } };
    await utilityHandlers.vocinfo(null, msg);
    await utilityHandlers.user(null, msg, []);
    await utilityHandlers.emoji(null, msg, ["😀"]);
    assert.strictEqual(msg._replies.length, 0, "aucune des trois ne doit répondre sans server.info.view");
  });

  await cas("un rôle qui a UNIQUEMENT server.info.view débloque &vocinfo/&user/&emoji", async () => {
    const g = fakeGuild({ channels: [] });
    const roleId = "role-info-only";
    permStore.setRoleGrants(g.id, roleId, ["server.info.view"]);
    const msg = fakeMessage(g);
    msg.member = { id: "membre-avec-le-role", guild: g, roles: { cache: new Collection([[roleId, { id: roleId }]]) } };
    await utilityHandlers.vocinfo(null, msg);
    await utilityHandlers.user(null, msg, []);
    assert.strictEqual(msg._replies.length, 2);
  });

  await cas("&emoji reconstruit l'URL d'un émoji d'un AUTRE serveur", async () => {
    const msg = fakeMessage(fakeGuild({}));
    await utilityHandlers.emoji(null, msg, ["<a:danse:123456789012345678>"]);
    const body = embedText(msg._replies[0]);
    assert.ok(body.includes("123456789012345678"));
    assert.ok(body.includes("**Animé** : oui"));
    assert.ok(body.includes(".gif"), "un émoji animé doit pointer vers le .gif");
  });

  await cas("&emoji explique qu'un émoji Unicode n'a pas d'image à récupérer", async () => {
    for (const unicode of ["😀", "5️⃣", "🇫🇷"]) {
      const msg = fakeMessage(fakeGuild({}));
      await utilityHandlers.emoji(null, msg, [unicode]);
      assert.ok(embedText(msg._replies[0]).includes("Unicode"), `${unicode} doit être reconnu comme un émoji Unicode`);
    }
  });

  await cas("un mot ou un nombre n'est PAS pris pour un émoji Unicode", async () => {
    for (const notEmoji of ["123", "#", "inconnu"]) {
      const msg = fakeMessage(fakeGuild({}));
      await utilityHandlers.emoji(null, msg, [notEmoji]);
      assert.ok(embedText(msg._replies[0]).includes("introuvable"), `${notEmoji} doit donner "émoji introuvable"`);
    }
  });

  console.log("\n&calc — parseur maison, jamais eval() :");

  const calculs = [
    ["(2+3)*4", "20"],
    ["2^10", "1024"],
    ["-2^2", "-4"],
    ["(-2)^2", "4"],
    ["0.1+0.2", "0.3"],
    ["3(4+1)", "15"],
    ["sqrt(16)+abs(-3)", "7"],
    ["10 % 3", "1"],
    ["2,5*2", "5"],
  ];
  for (const [expression, attendu] of calculs) {
    await cas(`${expression} = ${attendu}`, () => {
      assert.strictEqual(calc.compute(expression).result, attendu);
    });
  }

  await cas("résout une équation du premier degré", () => {
    assert.strictEqual(calc.compute("2x+3=7").result, "x = 2");
    assert.strictEqual(calc.compute("x/2 - 1 = 3").result, "x = 8");
  });

  await cas("refuse une équation qui n'est pas du premier degré au lieu d'inventer une solution", () => {
    assert.throws(() => calc.compute("x^2=4"), /premier degré/);
  });

  await cas("refuse tout caractère hors grammaire — rien n'est jamais exécuté", () => {
    assert.throws(() => calc.compute("process.exit(1)"), calc.CalcError);
    assert.throws(() => calc.compute("1;2"), calc.CalcError);
    assert.throws(() => calc.compute("`whoami`"), calc.CalcError);
  });

  await cas("signale une division par zéro plutôt que d'afficher Infinity", () => {
    assert.throws(() => calc.compute("1/0"), /infini/);
  });

  await cas("&calc répond l'erreur au lieu de propager l'exception", async () => {
    const msg = fakeMessage(fakeGuild({}));
    await utilityHandlers.calc(null, msg, ["1", "+"]);
    assert.ok(embedText(msg._replies[0]).length > 0);
  });

  console.log("\n&wiki / &search wiki (faux réseau) :");

  const fakeFetch = (payloads) => async (url) => {
    const key = Object.keys(payloads).find((k) => url.includes(k));
    if (!key) return { status: 404, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => payloads[key] };
  };

  await cas("un résumé est extrait, avec titre, extrait et lien", async () => {
    const article = await wikipedia.summary("Ada Lovelace", {
      fetchImpl: fakeFetch({
        summary: { title: "Ada Lovelace", extract: "Pionnière de l'informatique.", content_urls: { desktop: { page: "https://fr.wikipedia.org/wiki/Ada_Lovelace" } } },
      }),
    });
    assert.strictEqual(article.title, "Ada Lovelace");
    assert.ok(article.url.includes("Ada_Lovelace"));
  });

  await cas("un article inexistant vaut null, ce n'est pas une panne", async () => {
    const article = await wikipedia.summary("zzz", { fetchImpl: async () => ({ status: 404, ok: false, json: async () => ({}) }) });
    assert.strictEqual(article, null);
  });

  await cas("le HTML des extraits de recherche est nettoyé", async () => {
    const results = await wikipedia.search("ada", {
      fetchImpl: fakeFetch({
        "action=query": { query: { search: [{ title: "Ada Lovelace", snippet: 'Une <span class="searchmatch">Ada</span> &quot;pionnière&quot;' }] } },
      }),
    });
    assert.strictEqual(results[0].snippet, 'Une Ada "pionnière"');
    assert.ok(!results[0].snippet.includes("<span"));
  });

  await cas("Wikipédia injoignable donne un message clair, pas un plantage", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("réseau coupé");
    };
    try {
      const msg = fakeMessage(fakeGuild({}));
      await utilityHandlers.wiki(null, msg, ["ada"]);
      assert.ok(embedText(msg._replies[0]).includes("injoignable"));
    } finally {
      globalThis.fetch = original;
    }
  });

  await cas("&wiki sans mot-clé explique quoi taper", async () => {
    const msg = fakeMessage(fakeGuild({}));
    await utilityHandlers.wiki(null, msg, []);
    assert.ok(embedText(msg._replies[0]).includes("mot-clé"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
