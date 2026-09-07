/**
 * Vérifie la rubrique Accueil du panel — épurée (refonte UX demandée
 * explicitement : "garder uniquement l'essentiel : statut du bot, stats du
 * serveur, et seulement les vraies alertes importantes") :
 *  - statut (uptime/latence) et compteurs serveur toujours affichés, pour
 *    TOUT LE MONDE — ce ne sont pas des informations sensibles, contrairement
 *    au diagnostic complet (versions, nœuds Lavalink) qui reste réservé au
 *    rang sys dans Monitoring ;
 *  - au plus DEUX alertes de sécurité, les plus graves en premier, gated par
 *    la même permission que les rubriques Protection/Anti-nuke ;
 *  - plus d'"Activité récente" sur cet écran (alourdissait l'accueil, déjà
 *    consultable dans Modération > Historique).
 *
 * Lancement : node scripts/test-panel-dashboard.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-dashboard-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel } = require("../utils/configPanel");
const guardConfig = require("../utils/guard/config");
const permStore = require("../utils/permissions/store");
const antiSpam = require("../utils/automod/antiSpam");
const antiLink = require("../utils/automod/antiLink");
const antiMention = require("../utils/automod/antiMention");
const badWords = require("../utils/automod/badWords");
const muteStore = require("../utils/muteStore");
const modLogStore = require("../utils/modLogStore");

/** Configure tout ce que computeSecurityScan vérifie pour un état "OK" complet. */
function rendreServeurSain(guildId) {
  guardConfig.setEnabled(guildId, true);
  antiSpam.setEnabled(guildId, true);
  antiLink.setEnabled(guildId, true);
  antiMention.setEnabled(guildId, true);
  badWords.setEnabled(guildId, true);
  muteStore.setMuteRoleId(guildId, "role-mute-1");
  modLogStore.setLogChannelId(guildId, "moderation", "chan-logs-1");
}

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

function makeGuild() {
  const voiceState = { channelId: "vc-1" };
  return {
    id: "gdash",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 42,
    roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection([["u1", voiceState]]) },
    client: { uptime: 987654, ws: { ping: 17 }, guilds: { cache: new Collection() } },
  };
}

function homeText(guild, member) {
  const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
  return json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
}

/** Membre minimal, sans aucun droit accordé (ni propriétaire, ni rôle). */
function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "gdash", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

(async () => {
  console.log("Accueil épuré — statut, stats serveur, au plus 2 alertes :");

  const guild = makeGuild();

  await cas("un membre SANS AUCUN droit voit déjà le statut (uptime/latence) — ce n'est pas une info sensible", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(texte.includes("En ligne"), texte);
    assert.ok(texte.includes("17ms"), texte);
  });

  await cas("les compteurs serveur (membres/salons/vocal) sont affichés, sans permission particulière", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(texte.includes("42 membres"), texte);
    assert.ok(texte.includes("1 en vocal"), texte);
  });

  await cas("l'ancien contenu (préfixes) et l'\"Activité récente\" n'apparaissent plus du tout sur l'accueil", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(!texte.includes("Préfixe musique"), texte);
    assert.ok(!texte.includes("Activité récente"), texte);
  });

  await cas("sans le droit protection.automod/protection.guard.manage, aucune alerte de sécurité affichée", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(!texte.includes("🟢 Tout est en ordre") && !texte.includes("🔴") && !texte.includes("🟠"), texte);
  });

  await cas("avec protection.guard.manage, une alerte reflète le VRAI état de l'anti-nuke — puis disparaît une fois réglé", () => {
    permStore.setRoleGrants("gdash", "role-guard", ["protection.guard.manage"]);
    const member = mkMember("u-guard", "role-guard");

    guardConfig.setEnabled("gdash", false);
    let texte = homeText(guild, member);
    assert.ok(texte.includes("Anti-nuke désactivé"), texte);

    guardConfig.setEnabled("gdash", true);
    texte = homeText(guild, member);
    assert.ok(!texte.includes("Anti-nuke désactivé"), "l'alerte doit disparaître une fois l'anti-nuke réactivé");
  });

  await cas("tout est en ordre -> une seule ligne \"Tout est en ordre\", pas la liste complète des contrôles OK", () => {
    const guildSain = makeGuild();
    guildSain.roles.cache.set("role-mute-1", { id: "role-mute-1", managed: false, permissions: { has: () => false } });
    rendreServeurSain("gdash");
    const member = mkMember("u-guard", "role-guard");
    const texte = homeText(guildSain, member);
    assert.ok(texte.includes("🟢 Tout est en ordre."), texte);
    assert.ok(!texte.includes("contrôle(s) OK"), "l'accueil épuré ne doit pas reprendre le détail complet de l'audit");
  });

  await cas("jamais plus de DEUX alertes à l'accueil, même si l'audit complet en trouve plus", () => {
    // @everyone avec une permission dangereuse (critique) + anti-nuke
    // désactivé (avertissement) + AutoMod entièrement désactivé
    // (avertissement) : au moins 3 signaux réels, mais l'accueil épuré n'en
    // garde que 2 (les plus graves), le reste restant dans Sécurité > Vue
    // d'ensemble.
    const { PermissionFlagsBits } = require("discord.js");
    const guildAvecProblemes = makeGuild();
    guildAvecProblemes.roles.everyone = { permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]) };
    guardConfig.setEnabled("gdash", false);
    const member = mkMember("u-guard2", "role-guard");
    permStore.setRoleGrants("gdash", "role-guard", ["protection.guard.manage"]);
    const texte = homeText(guildAvecProblemes, member);
    const nbAlertes = (texte.match(/🔴|🟠/g) || []).length;
    assert.ok(nbAlertes <= 2, `${nbAlertes} alertes affichées — l'accueil épuré doit en garder 2 maximum`);
    assert.ok(texte.includes("@everyone"), "l'alerte la plus grave (critique) doit être celle gardée en premier");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
