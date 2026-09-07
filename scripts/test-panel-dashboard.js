/**
 * Vérifie la rubrique Accueil du panel (module 2 de la refonte) : un vrai
 * dashboard, pas le fourre-tout préfixes/rang sys qu'affichait "home"
 * auparavant. Chaque widget doit :
 *  - être gated par la même permission que la rubrique dont il résume l'état
 *    (Sécurité -> protection.automod/protection.guard.manage, Activité
 *    récente -> logs.view, Bot -> rang sys) ;
 *  - refléter les VRAIS réglages stockés (mêmes stores que les rubriques
 *    dédiées), jamais une valeur inventée.
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
const historyStore = require("../utils/moderationHistoryStore");
const guardConfig = require("../utils/guard/config");
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
  console.log("Accueil — un vrai dashboard, pas le résumé préfixes/rang sys :");

  const guild = makeGuild();

  await cas("les compteurs serveur (membres/rôles/salons/vocal) sont toujours affichés, sans permission particulière", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(texte.includes("**Membres** : 42"), texte);
    assert.ok(texte.includes("en vocal** : 1"), texte);
    assert.ok(!texte.includes("Préfixe musique"), "l'ancien contenu (préfixes) ne doit plus apparaître sur l'accueil");
  });

  await cas("sans le droit protection.automod/protection.guard.manage, aucun widget Sécurité", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(!texte.includes("Sécurité"), texte);
  });

  await cas("avec protection.guard.manage, le widget Sécurité reflète le VRAI état de l'anti-nuke", () => {
    permStore.setRoleGrants("gdash", "role-guard", ["protection.guard.manage"]);
    const member = mkMember("u-guard", "role-guard");

    guardConfig.setEnabled("gdash", false);
    let texte = homeText(guild, member);
    assert.ok(texte.includes("🟠 Sécurité") || texte.includes("🔴 Sécurité"), texte);
    assert.ok(texte.includes("Anti-nuke désactivé"), texte);

    guardConfig.setEnabled("gdash", true);
    texte = homeText(guild, member);
    assert.ok(!texte.includes("Anti-nuke désactivé"), "l'alerte doit disparaître une fois l'anti-nuke réactivé");
  });

  await cas("sans le droit logs.view, aucun widget Activité récente", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(!texte.includes("Activité récente"), texte);
  });

  await cas("avec logs.view, l'activité récente montre les VRAIES dernières entrées de l'historique", () => {
    permStore.setRoleGrants("gdash", "role-logs", ["logs.view"]);
    const member = mkMember("u-logs", "role-logs");
    historyStore.record({ guildId: "gdash", targetId: "111111111111111111", moderatorId: "222222222222222222", action: "kick" });
    const texte = homeText(guild, member);
    assert.ok(texte.includes("Activité récente"), texte);
    assert.ok(texte.includes("`kick`"), texte);
  });

  await cas("qui n'a PAS le rang sys ne voit aucun widget Bot (diagnostics)", () => {
    const texte = homeText(guild, mkMember("u-none"));
    assert.ok(!texte.includes("**Bot**"), texte);
  });

  await cas("le propriétaire voit le widget Bot avec les VRAIS uptime/latence/nombre de serveurs", () => {
    const owner = { id: "owner-1", guild: { id: "gdash", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
    const texte = homeText(guild, owner);
    assert.ok(texte.includes("**⚙️ Bot**"), texte);
    assert.ok(texte.includes("17ms"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
