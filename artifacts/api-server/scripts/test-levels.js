/**
 * Système de niveaux/XP (utils/levelStore.js, utils/levels.js) — &rank,
 * &leaderboard, &levels on/off. La permission "server.levels.manage" existe
 * dans le catalogue depuis toujours (utils/permissions/catalog.js) mais
 * n'avait jamais eu d'implémentation avant ce chantier. Désactivé par
 * défaut par serveur, comme le reste de l'automod léger.
 *
 * Lancement : node scripts/test-levels.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "levels-test-"));

const { Collection } = require("discord.js");
const levelStore = require("../utils/levelStore");
const levels = require("../utils/levels");
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

(async () => {
console.log("levelStore — formule et cooldown :");

await cas("xpPourNiveau suit la formule 5*n*n + 50*n + 100", () => {
  assert.strictEqual(levelStore.xpPourNiveau(1), 155);
  assert.strictEqual(levelStore.xpPourNiveau(2), 220);
  assert.strictEqual(levelStore.xpPourNiveau(0), 100);
});

await cas("addXp respecte le cooldown : un second appel trop rapide est refusé (null)", () => {
  const t0 = 1_000_000;
  const premier = levelStore.addXp("g1", "u1", 20, 60, t0);
  assert.ok(premier);
  const second = levelStore.addXp("g1", "u1", 20, 60, t0 + 5000); // 5s < 60s de cooldown
  assert.strictEqual(second, null);
  assert.strictEqual(levelStore.getUserData("g1", "u1").xp, 20);
});

await cas("après le cooldown écoulé, l'XP s'accumule normalement", () => {
  const t0 = 2_000_000;
  levelStore.addXp("g2", "u2", 20, 60, t0);
  const suite = levelStore.addXp("g2", "u2", 20, 60, t0 + 61_000);
  assert.ok(suite);
  assert.strictEqual(levelStore.getUserData("g2", "u2").xp, 40);
});

await cas("un gain d'XP qui dépasse le seuil fait passer un ou plusieurs niveaux d'un coup", () => {
  const resultat = levelStore.addXp("g3", "u3", 500, 60, 3_000_000);
  assert.strictEqual(resultat.leveledUp, true);
  assert.ok(resultat.level >= 1);
  assert.strictEqual(levelStore.getUserData("g3", "u3").level, resultat.level);
});

await cas("un gain d'XP qui ne franchit AUCUN seuil ne signale pas de passage de niveau", () => {
  const resultat = levelStore.addXp("g4", "u4", 10, 60, 4_000_000);
  assert.strictEqual(resultat.leveledUp, false);
  assert.strictEqual(resultat.level, 0);
});

await cas("getLeaderboard trie par XP décroissant", () => {
  levelStore.addXp("g5", "petit", 10, 0, 5_000_000);
  levelStore.addXp("g5", "grand", 200, 0, 5_000_001);
  levelStore.addXp("g5", "moyen", 50, 0, 5_000_002);
  const classement = levelStore.getLeaderboard("g5");
  assert.deepStrictEqual(
    classement.map((r) => r.userId),
    ["grand", "moyen", "petit"]
  );
});

await cas("config désactivée par défaut, valeurs XP/cooldown par défaut cohérentes", () => {
  const config = levelStore.getConfig("g6-jamais-touche");
  assert.strictEqual(config.enabled, false);
  assert.strictEqual(config.xpMin, 15);
  assert.strictEqual(config.xpMax, 25);
  assert.strictEqual(config.cooldownSeconds, 60);
});

console.log("\nlevels.checkMessage (messageCreate) :");

function fakeMessage({ guildId = "gm1", authorId = "am1", authorBot = false, mentionedMember = null, channelSend } = {}) {
  return {
    author: { id: authorId, bot: authorBot },
    guild: { id: guildId, channels: { cache: new Collection() } },
    mentions: { members: { first: () => mentionedMember } },
    channel: { send: channelSend || (async () => ({})) },
  };
}

await cas("désactivé par défaut : aucun XP gagné même avec beaucoup de messages", async () => {
  const msg = fakeMessage({ guildId: "gm-off", authorId: "u-off" });
  await levels.checkMessage(null, msg);
  assert.strictEqual(levelStore.getUserData("gm-off", "u-off").xp, 0);
});

await cas("une fois activé, un message donne de l'XP dans la fourchette configurée", async () => {
  levelStore.setEnabled("gm-on", true);
  const msg = fakeMessage({ guildId: "gm-on", authorId: "u-on" });
  await levels.checkMessage(null, msg);
  const donnees = levelStore.getUserData("gm-on", "u-on");
  assert.ok(donnees.xp >= 15 && donnees.xp <= 25, `xp=${donnees.xp}`);
});

await cas("un passage de niveau poste une annonce dans le salon du message (pas de salon dédié configuré)", async () => {
  levelStore.setEnabled("gm-levelup", true);
  const envoyes = [];
  // Pousse artificiellement près du seuil pour forcer un passage de niveau au message suivant.
  levelStore.addXp("gm-levelup", "u-levelup", 150, 0, 1);
  const msg = fakeMessage({ guildId: "gm-levelup", authorId: "u-levelup", channelSend: async (c) => envoyes.push(c) });
  await levels.checkMessage(null, msg);
  assert.strictEqual(envoyes.length, 1);
  assert.ok(envoyes[0].includes("niveau"));
});

await cas("un message de bot n'accorde jamais d'XP", async () => {
  levelStore.setEnabled("gm-bot", true);
  const msg = fakeMessage({ guildId: "gm-bot", authorId: "bot-1", authorBot: true });
  await levels.checkMessage(null, msg);
  assert.strictEqual(levelStore.getUserData("gm-bot", "bot-1").xp, 0);
});

console.log("\n&rank [@membre] :");

function fakeRankMessage({ guildId = "gr1", authorId = "ar1", mentionedMember = null } = {}) {
  const replies = [];
  return {
    guild: { id: guildId },
    member: { id: authorId, displayName: "Moi", user: { displayAvatarURL: () => "https://example.com/a.png" } },
    mentions: { members: { first: () => mentionedMember } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

await cas("&rank sans argument affiche SA PROPRE progression", async () => {
  levelStore.addXp("gr1", "ar1", 50, 0, 1);
  const msg = fakeRankMessage({});
  await levels.rank(null, msg, []);
  assert.strictEqual(msg._replies.length, 1);
  const texte = JSON.stringify(msg._replies[0]);
  assert.ok(texte.includes("Moi"), texte);
});

await cas("&rank @membre affiche la progression DE CE MEMBRE, pas celle de l'auteur", async () => {
  levelStore.addXp("gr2", "cible-rank", 300, 0, 1);
  const cibleMembre = { id: "cible-rank", displayName: "Cible", user: { displayAvatarURL: () => "https://example.com/b.png" } };
  const msg = fakeRankMessage({ guildId: "gr2", authorId: "auteur-rank", mentionedMember: cibleMembre });
  await levels.rank(null, msg, [`<@cible-rank>`]);
  const texte = JSON.stringify(msg._replies[0]);
  assert.ok(texte.includes("Cible"), texte);
});

await cas("&rank sans aucun XP affiche niveau 0 sans planter", async () => {
  const msg = fakeRankMessage({ guildId: "gr3", authorId: "jamais-actif" });
  await levels.rank(null, msg, []);
  const texte = JSON.stringify(msg._replies[0]);
  assert.ok(texte.includes('"value":"0"') || texte.includes("Niveau"), texte);
});

console.log("\n&leaderboard :");

await cas("&leaderboard poste un classement paginé (utils/listCard.js), vide si personne n'a d'XP", async () => {
  const msg = fakeRankMessage({ guildId: "gl1-vide" });
  await levels.leaderboard(null, msg);
  const texte = JSON.stringify(msg._replies[0]);
  assert.ok(texte.includes("Classement"), texte);
});

await cas("&leaderboard liste les membres qui ont de l'XP, triés", async () => {
  levelStore.addXp("gl2", "premier", 500, 0, 1);
  levelStore.addXp("gl2", "second", 100, 0, 1);
  const msg = fakeRankMessage({ guildId: "gl2" });
  await levels.leaderboard(null, msg);
  const texte = JSON.stringify(msg._replies[0]);
  const posPremier = texte.indexOf("premier");
  const posSecond = texte.indexOf("second");
  assert.ok(posPremier !== -1 && posSecond !== -1 && posPremier < posSecond, texte);
});

console.log("\n&levels on/off :");

function fakeToggleMessage({ guildId = "gt1", authorId = "staff-t1" } = {}) {
  const replies = [];
  return {
    guild: { id: guildId },
    member: { id: authorId, guild: { id: guildId }, roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

await cas("sans server.levels.manage, silence", async () => {
  const msg = fakeToggleMessage({ guildId: "gt-refuse", authorId: "sans-perm" });
  await levels.levelsToggle(null, msg, ["on"]);
  assert.strictEqual(msg._replies.length, 0);
  assert.strictEqual(levelStore.getConfig("gt-refuse").enabled, false);
});

await cas("avec la permission, \"on\" active vraiment le système pour ce serveur", async () => {
  permStore.grantToUser("gt-on", "staff-on", "server.levels.manage");
  const msg = fakeToggleMessage({ guildId: "gt-on", authorId: "staff-on" });
  await levels.levelsToggle(null, msg, ["on"]);
  assert.strictEqual(levelStore.getConfig("gt-on").enabled, true);
});

await cas("\"off\" désactive à nouveau", async () => {
  permStore.grantToUser("gt-off", "staff-off", "server.levels.manage");
  levelStore.setEnabled("gt-off", true);
  const msg = fakeToggleMessage({ guildId: "gt-off", authorId: "staff-off" });
  await levels.levelsToggle(null, msg, ["off"]);
  assert.strictEqual(levelStore.getConfig("gt-off").enabled, false);
});

await cas("un mot autre que on/off rappelle juste la syntaxe, sans rien changer", async () => {
  permStore.grantToUser("gt-bad", "staff-bad", "server.levels.manage");
  const msg = fakeToggleMessage({ guildId: "gt-bad", authorId: "staff-bad" });
  await levels.levelsToggle(null, msg, ["nimportequoi"]);
  assert.strictEqual(levelStore.getConfig("gt-bad").enabled, false);
  assert.strictEqual(msg._replies.length, 1);
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
