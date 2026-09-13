/**
 * "!!secur" (utils/securityPanel.js) — TOUT ce qui concerne la sécurité DU
 * SERVEUR, déménagé intégralement depuis &panel > Sécurité (Vue d'ensemble,
 * Protection, Anti-nuke, Mute — utils/configPanel.js) sur demande explicite
 * ("enlève tout les trucs de sécurité du &panel et le mets dans !!secur").
 * Mêmes stores, mêmes permissions, mêmes réglages que l'ancien &panel — ce
 * fichier rejoue les vérifications qui vivaient dans
 * scripts/test-panel-security-overview.js, scripts/test-guard-panel-
 * controls.js et la partie "Protection" de scripts/test-tickets-securite-
 * reglages.js (tous les trois retirés/allégés), contre le nouveau point
 * d'accès.
 *
 * Scindé de "!!panel" (strictement personnel, voir
 * utils/personalProtection.js et scripts/test-personal-protection.js).
 *
 * Lancement : node scripts/test-security-panel.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "security-panel-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, PermissionsBitField } = require("discord.js");
const securityPanel = require("../utils/securityPanel");
const permStore = require("../utils/permissions/store");
const automod = require("../utils/automod/antiSpam");
const antiScam = require("../utils/automod/antiScam");
const antiLink = require("../utils/automod/antiLink");
const antiMention = require("../utils/automod/antiMention");
const badWords = require("../utils/automod/badWords");
const guardConfig = require("../utils/guard/config");
const guardWhitelist = require("../utils/guard/whitelist");
const { ALL_GUARDS } = require("../utils/guard/definitions");
const muteStore = require("../utils/muteStore");
const accessStore = require("../utils/accessStore");

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

const ROLE = "1546335998529642628";
const SALON = "1546335998529642631";

/** Un serveur assez riche pour computeSecurityScan (rôles/membres/permissions) ET les sélecteurs de salons/rôles. */
function fakeGuild(id) {
  return {
    id,
    ownerId: "owner-x",
    roles: {
      everyone: { permissions: new PermissionsBitField([]) },
      cache: new Collection([[ROLE, { id: ROLE, name: "Testeur", managed: false, permissions: new PermissionsBitField([]) }]]),
    },
    channels: { cache: new Collection([[SALON, { id: SALON, name: "general" }]]) },
    members: { cache: new Collection() },
  };
}

function fakeMessage(content, { authorId = "u1", guildId = "g1", isAdmin = false } = {}) {
  const replies = [];
  const channelSends = [];
  const guild = fakeGuild(guildId);
  return {
    content,
    author: { id: authorId, bot: false },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() }, permissions: { has: () => isAdmin } },
    channel: { send: async (p) => channelSends.push(p) },
    reply: async (p) => replies.push(p),
    _replies: replies,
    _channelSends: channelSends,
  };
}

function fakeInteraction(customId, { userId = "u1", guildId = "g1", values, client, isModal = false, fields } = {}) {
  const updates = [];
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    customId,
    guild,
    user: { id: userId },
    member: { id: userId, guild, roles: { cache: new Collection() }, permissions: { has: () => false } },
    values,
    client,
    isModalSubmit: () => isModal,
    fields,
    update: async (p) => updates.push(p),
    reply: async (p) => replies.push(p),
    message: { edit: async (p) => updates.push(p) },
    _updates: updates,
    _replies: replies,
  };
}

/** Toutes les options du menu d'action de la vue courante. */
function labelsAction(payload, customIdSuffix) {
  const json = payload.components[0].toJSON();
  const menu = json.components.filter((c) => c.type === 1).flatMap((r) => r.components).find((c) => c.custom_id === customIdSuffix);
  return menu ? menu.options.map((o) => o.label) : [];
}

(async () => {
  console.log("Mot-clé et préfixe :");

  await cas('un mot inconnu après "!!" reste silencieux', async () => {
    const msg = fakeMessage("!!nimportequoi");
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  await cas('le préfixe "&" n\'est pas concerné', async () => {
    const msg = fakeMessage("&secur");
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  console.log("\n!!secur — accès et navigation :");

  await cas("sans protection.automod NI protection.guard.manage, refusé", async () => {
    const msg = fakeMessage("!!secur", { authorId: "quidam-1", guildId: "g-refus" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
    assert.ok(msg._replies.length > 0);
  });

  await cas("avec protection.automod SEULEMENT, le panneau s'ouvre sur la Vue d'ensemble", async () => {
    permStore.grantToUser("g-auto", "staff-1", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-1", guildId: "g-auto" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 1);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("Vue d'ensemble"), texte);
  });

  await cas("le sous-menu bascule bien entre les 4 vues", async () => {
    permStore.grantToUser("g-nav", "staff-2", "protection.automod");
    permStore.grantToUser("g-nav", "staff-2", "protection.guard.manage");
    for (const vue of ["protection", "guard", "mute", "overview"]) {
      const interaction = fakeInteraction("secur:subnav", { userId: "staff-2", guildId: "g-nav", values: [vue] });
      await securityPanel.handleSecurityInteraction(interaction);
      assert.strictEqual(interaction._updates.length, 1, vue);
    }
  });

  console.log("\nVue d'ensemble (utils/securityScan.js, même fonction que &panel > Accueil) :");

  await cas("reflète le VRAI état — anti-nuke désactivé, un avertissement apparaît", async () => {
    permStore.grantToUser("g-scan", "staff-3", "protection.automod");
    const interaction = fakeInteraction("secur:subnav", { userId: "staff-3", guildId: "g-scan", values: ["overview"] });
    await securityPanel.handleSecurityInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Anti-nuke désactivé"), texte);
  });

  await cas("une fois l'anti-nuke réactivé, l'avertissement correspondant disparaît", async () => {
    permStore.grantToUser("g-scan2", "staff-4", "protection.automod");
    guardConfig.setEnabled("g-scan2", true);
    const interaction = fakeInteraction("secur:subnav", { userId: "staff-4", guildId: "g-scan2", values: ["overview"] });
    await securityPanel.handleSecurityInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(!texte.includes("Anti-nuke désactivé"), texte);
  });

  console.log("\nProtection — toutes les valeurs configurables, mêmes magasins que &panel :");

  await cas("sans protection.automod, la vue est verrouillée (pas de menu d'action)", async () => {
    permStore.grantToUser("g-plock", "staff-5", "protection.guard.manage");
    const interaction = fakeInteraction("secur:subnav", { userId: "staff-5", guildId: "g-plock", values: ["protection"] });
    await securityPanel.handleSecurityInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("protection.automod"), texte);
    assert.ok(!texte.includes("secur:protectionaction"));
  });

  await cas("toutes les actions attendues sont proposées, y compris salons exemptés/liens autorisés", async () => {
    permStore.grantToUser("g-plabels", "staff-6", "protection.automod");
    const interaction = fakeInteraction("secur:subnav", { userId: "staff-6", guildId: "g-plabels", values: ["protection"] });
    await securityPanel.handleSecurityInteraction(interaction);
    const labels = labelsAction(interaction._updates[0], "secur:protectionaction");
    for (const attendu of [
      "Anti-spam : changer le seuil (messages / secondes)",
      "Anti-spam : durée du timeout",
      "Anti-spam : salons exemptés",
      "Anti-lien : salons où les liens restent autorisés",
      "Anti-mass-mention : durée du timeout",
      "Mots interdits : ajouter un mot",
      "Anti-scam : activer/désactiver",
    ]) {
      assert.ok(labels.includes(attendu), `"${attendu}" manque : ${labels.join(" | ")}`);
    }
  });

  await cas("whitelist_add/remove n'apparaissent que si protection.whitelist est accordée séparément", async () => {
    permStore.grantToUser("g-pwl", "staff-7", "protection.automod");
    const sans = fakeInteraction("secur:subnav", { userId: "staff-7", guildId: "g-pwl", values: ["protection"] });
    await securityPanel.handleSecurityInteraction(sans);
    assert.ok(!labelsAction(sans._updates[0], "secur:protectionaction").includes("Whitelist : ajouter quelqu'un"));

    permStore.grantToUser("g-pwl", "staff-7", "protection.whitelist");
    const avec = fakeInteraction("secur:subnav", { userId: "staff-7", guildId: "g-pwl", values: ["protection"] });
    await securityPanel.handleSecurityInteraction(avec);
    assert.ok(labelsAction(avec._updates[0], "secur:protectionaction").includes("Whitelist : ajouter quelqu'un"));
  });

  await cas("spam_toggle/link_toggle/link_mode/mention_toggle/badwords_toggle s'exécutent immédiatement", async () => {
    permStore.grantToUser("g-ptoggle", "staff-8", "protection.automod");
    const gid = "g-ptoggle";
    const avantSpam = automod.getConfig(gid).enabled;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-8", guildId: gid, values: ["spam_toggle"] }));
    assert.strictEqual(automod.getConfig(gid).enabled, !avantSpam);

    const avantLink = antiLink.getConfig(gid).enabled;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-8", guildId: gid, values: ["link_toggle"] }));
    assert.strictEqual(antiLink.getConfig(gid).enabled, !avantLink);

    const avantMode = antiLink.getConfig(gid).mode;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-8", guildId: gid, values: ["link_mode"] }));
    assert.notStrictEqual(antiLink.getConfig(gid).mode, avantMode);

    const avantMention = antiMention.getConfig(gid).enabled;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-8", guildId: gid, values: ["mention_toggle"] }));
    assert.strictEqual(antiMention.getConfig(gid).enabled, !avantMention);

    const avantWords = badWords.getConfig(gid).enabled;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-8", guildId: gid, values: ["badwords_toggle"] }));
    assert.strictEqual(badWords.getConfig(gid).enabled, !avantWords);

    const avantScam = antiScam.getConfig(gid).enabled;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-8", guildId: gid, values: ["scam_toggle"] }));
    assert.strictEqual(antiScam.getConfig(gid).enabled, !avantScam);
  });

  await cas("les seuils/durées défilent par paliers valides", async () => {
    permStore.grantToUser("g-pseuils", "staff-9", "protection.automod");
    const gid = "g-pseuils";
    const avant = automod.getConfig(gid);
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-9", guildId: gid, values: ["spam_threshold"] }));
    const apres = automod.getConfig(gid);
    assert.notDeepStrictEqual([apres.maxMessages, apres.windowSeconds], [avant.maxMessages, avant.windowSeconds]);

    for (const [action, lire] of [
      ["spam_timeout", () => automod.getConfig(gid).timeoutSeconds],
      ["mention_timeout", () => antiMention.getConfig(gid).timeoutSeconds],
      ["mention_threshold", () => antiMention.getConfig(gid).maxMentions],
    ]) {
      const avantVal = lire();
      await securityPanel.handleSecurityInteraction(fakeInteraction("secur:protectionaction", { userId: "staff-9", guildId: gid, values: [action] }));
      assert.notStrictEqual(lire(), avantVal, action);
    }
  });

  await cas("salons exemptés (anti-spam) et autorisés (anti-lien) REMPLACENT la liste", async () => {
    permStore.grantToUser("g-pchan", "staff-10", "protection.automod");
    const gid = "g-pchan";
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:spamexempt", { userId: "staff-10", guildId: gid, values: [SALON] }));
    assert.deepStrictEqual(automod.getExemptChannels(gid), [SALON]);
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:spamexempt", { userId: "staff-10", guildId: gid, values: [] }));
    assert.deepStrictEqual(automod.getExemptChannels(gid), []);

    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:linkallow", { userId: "staff-10", guildId: gid, values: [SALON] }));
    assert.deepStrictEqual(antiLink.getAllowedChannels(gid), [SALON]);
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:linkallow", { userId: "staff-10", guildId: gid, values: [] }));
    assert.deepStrictEqual(antiLink.getAllowedChannels(gid), []);
  });

  await cas("ajouter un mot interdit (bouton -> modale) puis le retirer (select)", async () => {
    permStore.grantToUser("g-pwords", "staff-11", "protection.automod");
    const gid = "g-pwords";
    const soumission = fakeInteraction("secur:badwords:add", {
      userId: "staff-11",
      guildId: gid,
      isModal: true,
      fields: { getTextInputValue: () => "vilainmot" },
    });
    await securityPanel.handleSecurityInteraction(soumission);
    assert.ok(badWords.getWords(gid).includes("vilainmot"));

    await securityPanel.handleSecurityInteraction(
      fakeInteraction("secur:badwords:del", { userId: "staff-11", guildId: gid, values: ["vilainmot"] })
    );
    assert.ok(!badWords.getWords(gid).includes("vilainmot"));
  });

  await cas("whitelist anti-spam : ajouter/retirer, gated par protection.whitelist", async () => {
    permStore.grantToUser("g-pwl2", "staff-12", "protection.whitelist");
    const gid = "g-pwl2";
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:wladd", { userId: "staff-12", guildId: gid, values: ["cible-1"] }));
    assert.ok(automod.getWhitelist(gid).users.includes("cible-1"));
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:wldel", { userId: "staff-12", guildId: gid, values: ["cible-1"] }));
    assert.ok(!automod.getWhitelist(gid).users.includes("cible-1"));
  });

  console.log("\nAnti-nuke — toutes les valeurs configurables, mêmes magasins que &panel :");

  await cas("sans protection.guard.manage, la vue est verrouillée (pas de menu)", async () => {
    permStore.grantToUser("g-glock", "staff-13", "protection.automod");
    const interaction = fakeInteraction("secur:subnav", { userId: "staff-13", guildId: "g-glock", values: ["guard"] });
    await securityPanel.handleSecurityInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("protection.guard.manage"), texte);
    assert.ok(!texte.includes("secur:guardaction"));
  });

  await cas("toutes les actions anti-nuke sont proposées", async () => {
    permStore.grantToUser("g-glabels", "staff-14", "protection.guard.manage");
    const interaction = fakeInteraction("secur:subnav", { userId: "staff-14", guildId: "g-glabels", values: ["guard"] });
    await securityPanel.handleSecurityInteraction(interaction);
    const labels = labelsAction(interaction._updates[0], "secur:guardaction");
    for (const attendu of [
      "Changer la sanction (timeout → kick → ban)",
      "Activer/désactiver un guard précis",
      "Whitelist : ajouter quelqu'un",
      "Whitelist : ajouter un rôle",
      "Changer le rôle pingé",
      "Changer le seuil de compte",
    ]) {
      assert.ok(labels.includes(attendu), `"${attendu}" manque : ${labels.join(" | ")}`);
    }
  });

  await cas("guard_toggle/guard_punishment/guard_autolockdown_toggle s'exécutent immédiatement", async () => {
    permStore.grantToUser("g-gtoggle", "staff-15", "protection.guard.manage");
    const gid = "g-gtoggle";
    const avantEnabled = guardConfig.getConfig(gid).enabled;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardaction", { userId: "staff-15", guildId: gid, values: ["guard_toggle"] }));
    assert.strictEqual(guardConfig.getConfig(gid).enabled, !avantEnabled);

    const avantPunishment = guardConfig.getConfig(gid).punishment;
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardaction", { userId: "staff-15", guildId: gid, values: ["guard_punishment"] }));
    assert.notStrictEqual(guardConfig.getConfig(gid).punishment, avantPunishment);

    const avantLockdown = guardConfig.getConfig(gid).autoLockdownOnCap;
    await securityPanel.handleSecurityInteraction(
      fakeInteraction("secur:guardaction", { userId: "staff-15", guildId: gid, values: ["guard_autolockdown_toggle"] })
    );
    assert.strictEqual(guardConfig.getConfig(gid).autoLockdownOnCap, !avantLockdown);
  });

  await cas("guard_pick révèle le menu des 13 guards, en choisir un affiche son bouton toggle", async () => {
    permStore.grantToUser("g-gpick", "staff-16", "protection.guard.manage");
    const gid = "g-gpick";
    const ouverture = await (async () => {
      const i = fakeInteraction("secur:guardaction", { userId: "staff-16", guildId: gid, values: ["guard_pick"] });
      await securityPanel.handleSecurityInteraction(i);
      return i;
    })();
    const json = ouverture._updates[0].components[0].toJSON();
    const menuRow = json.components.find((c) => c.type === 1 && c.components[0]?.custom_id === "secur:guardpick");
    assert.ok(menuRow, "le menu de choix de guard doit apparaître");
    assert.strictEqual(menuRow.components[0].options.length, ALL_GUARDS.length);

    const choix = fakeInteraction("secur:guardpick", { userId: "staff-16", guildId: gid, values: ["antibot"] });
    await securityPanel.handleSecurityInteraction(choix);
    const jsonChoix = choix._updates[0].components[0].toJSON();
    const bouton = jsonChoix.components.find((c) => c.type === 1 && c.components[0]?.custom_id === "secur:guardtoggle:antibot");
    assert.ok(bouton, "le bouton toggle du guard choisi doit apparaître");

    guardConfig.setEnabled(gid, true);
    const avant = guardConfig.isGuardEnabled(gid, "antibot");
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardtoggle:antibot", { userId: "staff-16", guildId: gid }));
    assert.notStrictEqual(guardConfig.isGuardEnabled(gid, "antibot"), avant);
  });

  await cas("whitelist anti-nuke : utilisateurs ET rôles", async () => {
    permStore.grantToUser("g-gwl", "staff-17", "protection.guard.manage");
    const gid = "g-gwl";
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardwladd", { userId: "staff-17", guildId: gid, values: ["cible-2"] }));
    assert.ok(guardWhitelist.getWhitelist(gid).users.includes("cible-2"));
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardwldel", { userId: "staff-17", guildId: gid, values: ["cible-2"] }));
    assert.ok(!guardWhitelist.getWhitelist(gid).users.includes("cible-2"));

    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardwlroleadd", { userId: "staff-17", guildId: gid, values: [ROLE] }));
    assert.ok(guardWhitelist.getWhitelist(gid).roles.includes(ROLE));
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardwlroledel", { userId: "staff-17", guildId: gid, values: [ROLE] }));
    assert.ok(!guardWhitelist.getWhitelist(gid).roles.includes(ROLE));
  });

  await cas("rôle pingé réglable (vide = aucun)", async () => {
    permStore.grantToUser("g-gping", "staff-18", "protection.guard.manage");
    const gid = "g-gping";
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardping", { userId: "staff-18", guildId: gid, values: [ROLE] }));
    assert.strictEqual(guardConfig.getConfig(gid).pingRoleId, ROLE);
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardping", { userId: "staff-18", guildId: gid, values: [] }));
    assert.strictEqual(guardConfig.getConfig(gid).pingRoleId, null);
  });

  await cas("seuil de création de compte (bouton -> modale), \"off\" désactive", async () => {
    permStore.grantToUser("g-glimit", "staff-19", "protection.guard.manage");
    const gid = "g-glimit";
    const soumission = fakeInteraction("secur:guardcreationlimit", {
      userId: "staff-19",
      guildId: gid,
      isModal: true,
      fields: { getTextInputValue: () => "7d" },
    });
    await securityPanel.handleSecurityInteraction(soumission);
    assert.strictEqual(guardConfig.getConfig(gid).creationLimitMs, 7 * 86400000);

    const off = fakeInteraction("secur:guardcreationlimit", {
      userId: "staff-19",
      guildId: gid,
      isModal: true,
      fields: { getTextInputValue: () => "off" },
    });
    await securityPanel.handleSecurityInteraction(off);
    assert.strictEqual(guardConfig.getConfig(gid).creationLimitMs, 0);
  });

  await cas("« Tout activer »/« Tout désactiver » agissent sur les 13 guards réels", async () => {
    permStore.grantToUser("g-gall", "staff-20", "protection.guard.manage");
    const gid = "g-gall";
    guardConfig.setEnabled(gid, true);
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardall:on", { userId: "staff-20", guildId: gid }));
    assert.ok(ALL_GUARDS.every((g) => guardConfig.isGuardEnabled(gid, g.key)));
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:guardall:off", { userId: "staff-20", guildId: gid }));
    assert.ok(ALL_GUARDS.every((g) => !guardConfig.isGuardEnabled(gid, g.key)));
  });

  await cas("basculer un guard sans protection.guard.manage est refusé", async () => {
    const interaction = fakeInteraction("secur:guardpick", { userId: "quidam-4", guildId: "g-guardrefus", values: ["antibot"] });
    await securityPanel.handleSecurityInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.ok(interaction._replies.length > 0);
    assert.strictEqual(guardConfig.isGuardEnabled("g-guardrefus", "antibot"), false);
  });

  console.log("\nMute — rôle réglable, même magasin que &panel :");

  await cas("sans protection.automod, la vue est verrouillée", async () => {
    const interaction = fakeInteraction("secur:subnav", { userId: "quidam-5", guildId: "g-mlock", values: ["mute"] });
    await securityPanel.handleSecurityInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("protection.automod"), texte);
  });

  await cas("choisir puis effacer le rôle de mute le retire vraiment", async () => {
    permStore.grantToUser("g-mute", "staff-21", "protection.automod");
    const gid = "g-mute";
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:muterole", { userId: "staff-21", guildId: gid, values: [ROLE] }));
    assert.strictEqual(muteStore.getMuteRoleId(gid), ROLE);
    await securityPanel.handleSecurityInteraction(fakeInteraction("secur:muterole", { userId: "staff-21", guildId: gid, values: [] }));
    assert.strictEqual(muteStore.getMuteRoleId(gid), null);
  });

  console.log("\nRésumé — données réelles, rien d'inventé :");

  await cas("compte les VRAIS propriétaires/rang sys via accessStore", async () => {
    const avant = process.env.BOT_OWNER_IDS;
    process.env.BOT_OWNER_IDS = "owner-a,owner-b";
    accessStore.add("sys", "sys-a");
    permStore.grantToUser("g-dash1", "staff-22", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-22", guildId: "g-dash1" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("2") && texte.includes("propriétaire"), texte);
    assert.ok(texte.includes("1") && texte.includes("rang sys"), texte);
    process.env.BOT_OWNER_IDS = avant;
  });

  await cas("sans client fourni, aucune stat uptime/ping n'est affichée (jamais de plantage)", async () => {
    permStore.grantToUser("g-dash3", "staff-23", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-23", guildId: "g-dash3" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 1);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(!texte.includes("ping"), texte);
  });

  await cas("avec un client réel, l'uptime/ping du VRAI statusDiagnostic apparaissent", async () => {
    permStore.grantToUser("g-dash4", "staff-24", "protection.automod");
    const fauxClient = { uptime: 3_600_000, ws: { ping: 42 }, guilds: { cache: new Collection() } };
    const msg = fakeMessage("!!secur", { authorId: "staff-24", guildId: "g-dash4" });
    await securityPanel.handleSecurityTextCommand(fauxClient, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("42ms"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
