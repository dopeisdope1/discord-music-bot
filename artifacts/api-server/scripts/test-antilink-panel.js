/**
 * Vérifie "!!antilink panel" (utils/antiLinkPanel.js) : panneau dédié à
 * l'anti-lien (utils/automod/antiLink.js), mode + deux listes de bypass
 * membre/rôle indépendantes (utils/automod/antiLinkBypass.js) —
 * "Tous les liens" (exempte tout) et "Liens Discord" (exempte uniquement
 * les invitations, utile en mode Anti-All).
 *
 * Fichier volontairement indépendant de la machine à états de
 * !!secur/&panel — même principe que utils/palierPanel.js.
 *
 * Lancement : node scripts/test-antilink-panel.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "antilink-panel-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const antiLinkPanel = require("../utils/antiLinkPanel");
const antiLink = require("../utils/automod/antiLink");
const linkBypass = require("../utils/automod/antiLinkBypass");

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

const guild = { id: "g1" };
const owner = { id: "owner-1", guild, roles: { cache: new Collection() } };
const quidam = { id: "quidam-1", guild, roles: { cache: new Collection() } };

function jsonDe(payload) {
  return JSON.stringify(payload.components[0].toJSON());
}

function fakeMessage(member) {
  const replies = [];
  return {
    author: { id: member.id },
    member,
    guild,
    reply: async (p) => {
      replies.push(p);
      return { id: `msg-${replies.length}` };
    },
    _replies: replies,
  };
}

function fakeInteraction(customId, member, values = []) {
  const updates = [];
  return {
    customId,
    member,
    guild,
    guildId: guild.id,
    values,
    // Simule une MentionableSelectMenuInteraction : un rôle connu de ce
    // fake "guild" ressort dans `.roles`, sinon c'est un membre.
    roles: new Collection(values.includes("role-1") ? [["role-1", { id: "role-1" }]] : []),
    update: async (p) => {
      updates.push(p);
      return p;
    },
    reply: async (p) => {
      updates.push(p);
      return p;
    },
    _updates: updates,
  };
}

function fakeMember(id, roleId) {
  return { id, guild, roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() } };
}

(async () => {
  console.log("Store de bypass (utils/automod/antiLinkBypass.js) :");

  await cas("les deux listes (all/invite) sont indépendantes", () => {
    linkBypass.addBypass("g1", "all", "users", "u1");
    linkBypass.addBypass("g1", "invite", "users", "u2");
    assert.deepStrictEqual(linkBypass.getBypass("g1", "all"), { users: ["u1"], roles: [] });
    assert.deepStrictEqual(linkBypass.getBypass("g1", "invite"), { users: ["u2"], roles: [] });
    linkBypass.removeBypass("g1", "invite", "users", "u2");
  });

  await cas("ajouter deux fois ne duplique pas, retirer un absent ne casse rien", () => {
    assert.strictEqual(linkBypass.addBypass("g1", "all", "users", "u1"), false);
    assert.strictEqual(linkBypass.removeBypass("g1", "all", "users", "absent"), false);
    assert.strictEqual(linkBypass.removeBypass("g1", "all", "users", "u1"), true);
    assert.deepStrictEqual(linkBypass.getBypass("g1", "all").users, []);
  });

  await cas("isBypassed reconnaît un rôle comme un membre", () => {
    linkBypass.addBypass("g1", "invite", "roles", "role-mod");
    assert.strictEqual(linkBypass.isBypassed(fakeMember("m1", "role-mod"), "invite"), true);
    assert.strictEqual(linkBypass.isBypassed(fakeMember("m1", "role-mod"), "all"), false);
    linkBypass.removeBypass("g1", "invite", "roles", "role-mod");
  });

  console.log("\nEffet réel sur l'anti-lien (utils/automod/antiLink.js) :");

  function fakeAutomodMessage(content, member) {
    const deleted = { value: false };
    return {
      author: { id: member.id, bot: false, tag: `${member.id}#0000` },
      member,
      guild,
      channel: { id: "c1" },
      content,
      deletable: true,
      delete: async () => {
        deleted.value = true;
      },
      _deleted: deleted,
    };
  }

  await cas("bypass \"Tous les liens\" exempte aussi bien une invitation qu'un lien quelconque", async () => {
    antiLink.setEnabled("g1", true);
    antiLink.setMode("g1", "all");
    linkBypass.addBypass("g1", "all", "users", "vip-1");
    const vip = fakeMember("vip-1");
    await antiLink.checkMessage({ user: { id: "bot" } }, fakeAutomodMessage("https://example.com", vip));
    let msg = fakeAutomodMessage("https://example.com", vip);
    await antiLink.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, false);
    msg = fakeAutomodMessage("discord.gg/abcd", vip);
    await antiLink.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, false);
    linkBypass.removeBypass("g1", "all", "users", "vip-1");
  });

  await cas("bypass \"Liens Discord\" n'exempte QUE les invitations, pas les autres liens (mode Anti-All)", async () => {
    linkBypass.addBypass("g1", "invite", "users", "vip-2");
    const vip = fakeMember("vip-2");
    const invite = fakeAutomodMessage("discord.gg/abcd", vip);
    await antiLink.checkMessage({ user: { id: "bot" } }, invite);
    assert.strictEqual(invite._deleted.value, false, "l'invitation doit être exemptée");
    const autre = fakeAutomodMessage("https://example.com", vip);
    await antiLink.checkMessage({ user: { id: "bot" } }, autre);
    assert.strictEqual(autre._deleted.value, true, "un lien non-Discord doit rester bloqué");
    linkBypass.removeBypass("g1", "invite", "users", "vip-2");
    antiLink.setEnabled("g1", false);
  });

  console.log("\nPanneau — permissions :");

  await cas("sans protection.automod, le texte reste lisible mais aucun menu n'apparaît", () => {
    const texte = jsonDe(antiLinkPanel.buildAntiLinkPanel(guild, quidam, {}));
    assert.ok(texte.includes("Panel Anti-Link"));
    assert.ok(!texte.includes(`${antiLinkPanel.CUSTOM_ID}:`));
  });

  await cas("le rang sys (BOT_OWNER_IDS) voit le menu d'actions", () => {
    const texte = jsonDe(antiLinkPanel.buildAntiLinkPanel(guild, owner, {}));
    assert.ok(texte.includes(`${antiLinkPanel.CUSTOM_ID}:action`));
    for (const label of ["Mode : Désactivé", "Mode : Anti-Discord", "Mode : Anti-All", "Ajouter Bypass (Tous les liens)", "Ajouter Bypass (Liens Discord)", "Supprimer un Bypass"]) {
      assert.ok(texte.includes(label), `option manquante : ${label}`);
    }
  });

  await cas("une interaction sans la permission est refusée, jamais appliquée", async () => {
    const interaction = fakeInteraction(`${antiLinkPanel.CUSTOM_ID}:action`, quidam, ["mode_all"]);
    await antiLinkPanel.handleAntiLinkInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 1);
    assert.ok(interaction._updates[0].flags !== undefined, "le refus doit être une réponse éphémère, pas une mise à jour du panneau");
    assert.strictEqual(antiLink.getConfig("g1").enabled, false, "le mode ne doit pas avoir changé");
  });

  console.log("\nPanneau — affichage de l'état :");

  await cas("le mode actuel et les deux listes de bypass sont affichés", () => {
    linkBypass.addBypass("g1", "all", "users", "u-all");
    linkBypass.addBypass("g1", "invite", "roles", "role-inv");
    antiLink.setEnabled("g1", true);
    antiLink.setMode("g1", "invite");
    const texte = jsonDe(antiLinkPanel.buildAntiLinkPanel(guild, owner, {}));
    assert.ok(texte.includes("Anti-Discord"));
    assert.ok(texte.includes("<@u-all>"));
    assert.ok(texte.includes("<@&role-inv>"));
    linkBypass.removeBypass("g1", "all", "users", "u-all");
    linkBypass.removeBypass("g1", "invite", "roles", "role-inv");
    antiLink.setEnabled("g1", false);
  });

  await cas("aucun bypass : les deux sections affichent \"Aucun\"", () => {
    const texte = antiLinkPanel.buildAntiLinkPanel(guild, owner, {}).components[0].toJSON().components.map((c) => c.content).join("\n");
    assert.ok((texte.match(/Aucun/g) || []).length >= 2, texte);
  });

  console.log("\nPanneau — actions (mode, ajout, suppression) :");

  await cas("changer le mode l'applique réellement et referme le sélecteur secondaire", async () => {
    const interaction = fakeInteraction(`${antiLinkPanel.CUSTOM_ID}:action`, owner, ["mode_all"]);
    await antiLinkPanel.handleAntiLinkInteraction(interaction);
    assert.strictEqual(antiLink.getConfig("g1").enabled, true);
    assert.strictEqual(antiLink.getConfig("g1").mode, "all");
    const texte = JSON.stringify(interaction._updates[0]);
    assert.ok(!texte.includes("addpick") && !texte.includes("removepick"), "aucun sélecteur secondaire ne doit rester ouvert");
    antiLink.setEnabled("g1", false);
  });

  await cas("\"Ajouter Bypass\" déplie un sélecteur membre/rôle dédié au bon scope", async () => {
    const interaction = fakeInteraction(`${antiLinkPanel.CUSTOM_ID}:action`, owner, ["add_invite"]);
    await antiLinkPanel.handleAntiLinkInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0]);
    assert.ok(texte.includes(`${antiLinkPanel.CUSTOM_ID}:addpick:invite`), texte);
  });

  await cas("choisir un membre dans \"addpick\" l'ajoute côté \"users\"", async () => {
    const interaction = fakeInteraction(`${antiLinkPanel.CUSTOM_ID}:addpick:all`, owner, ["user-77"]);
    await antiLinkPanel.handleAntiLinkInteraction(interaction);
    assert.deepStrictEqual(linkBypass.getBypass("g1", "all").users, ["user-77"]);
    linkBypass.removeBypass("g1", "all", "users", "user-77");
  });

  await cas("choisir un rôle dans \"addpick\" l'ajoute côté \"roles\"", async () => {
    const interaction = fakeInteraction(`${antiLinkPanel.CUSTOM_ID}:addpick:invite`, owner, ["role-1"]);
    await antiLinkPanel.handleAntiLinkInteraction(interaction);
    assert.deepStrictEqual(linkBypass.getBypass("g1", "invite").roles, ["role-1"]);
    linkBypass.removeBypass("g1", "invite", "roles", "role-1");
  });

  await cas("\"Supprimer un Bypass\" liste les DEUX scopes ensemble, puis retire l'entrée choisie", async () => {
    linkBypass.addBypass("g1", "all", "users", "aa");
    linkBypass.addBypass("g1", "invite", "roles", "bb");
    const ouverture = fakeInteraction(`${antiLinkPanel.CUSTOM_ID}:action`, owner, ["remove"]);
    await antiLinkPanel.handleAntiLinkInteraction(ouverture);
    const texteOuvert = JSON.stringify(ouverture._updates[0]);
    assert.ok(texteOuvert.includes(`${antiLinkPanel.CUSTOM_ID}:removepick`));
    assert.ok(texteOuvert.includes("all:users:aa") && texteOuvert.includes("invite:roles:bb"), texteOuvert);

    const suppression = fakeInteraction(`${antiLinkPanel.CUSTOM_ID}:removepick`, owner, ["all:users:aa"]);
    await antiLinkPanel.handleAntiLinkInteraction(suppression);
    assert.deepStrictEqual(linkBypass.getBypass("g1", "all").users, []);
    assert.deepStrictEqual(linkBypass.getBypass("g1", "invite").roles, ["bb"]);
    linkBypass.removeBypass("g1", "invite", "roles", "bb");
  });

  console.log("\n\"!!antilink panel\" — commande texte :");

  await cas("poste le panneau et retient son propriétaire (messageOwner)", async () => {
    const msg = fakeMessage(owner);
    await antiLinkPanel.handleAntiLinkPanelCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(jsonDe(msg._replies[0]).includes("Panel Anti-Link"));
  });

  await cas("sans protection.automod, la commande texte reste muette", async () => {
    const msg = fakeMessage(quidam);
    await antiLinkPanel.handleAntiLinkPanelCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
