/**
 * Vérifie la rubrique "Vue d'ensemble" de la famille Sécurité (module 3 de la
 * refonte du panel) : Protection/Anti-nuke/Mute restent trois écrans
 * distincts avec leurs propres contrôles (rien n'est fusionné), mais choisir
 * la famille "Sécurité" depuis le menu principal ouvre maintenant d'abord un
 * résumé — la MÊME détection que `&security scan` (utils/securityScan.js::
 * computeSecurityScan), pas une deuxième logique inventée pour le panel.
 *
 * Lancement : node scripts/test-panel-security-overview.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-secoverview-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, ID } = require("../utils/configPanel");
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

const guild = {
  id: "gsec",
  name: "Serveur",
  ownerId: "owner-1",
  memberCount: 10,
  roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "gsec", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

function render(section, member) {
  const json = buildConfigPanel(guild, section, member).components[0].toJSON();
  return json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
}

function titre(section, member) {
  return buildConfigPanel(guild, section, member).components[0].toJSON().components.find((c) => c.type === 10).content;
}

(async () => {
  console.log("Sécurité — Vue d'ensemble en tête, écrans existants inchangés :");

  permStore.setRoleGrants("gsec", "role-sec", ["protection.automod", "protection.guard.manage"]);
  const member = mkMember("u-sec", "role-sec");

  await cas("sans protection.automod ni protection.guard.manage, la vue d'ensemble n'est pas proposée", () => {
    const noAccess = mkMember("u-none");
    // Section inaccessible -> buildConfigPanel retombe sur la première
    // rubrique réellement accessible à ce membre (ici : Accueil, pas
    // "Vue d'ensemble" de Sécurité).
    assert.ok(!titre("securityOverview", noAccess).includes("Vue d'ensemble"));
  });

  await cas("choisir la famille Sécurité ouvre d'abord la Vue d'ensemble, pas Protection directement", async () => {
    let panel = null;
    const interaction = {
      customId: `${ID}:nav:securite`,
      member,
      guild,
      update: async (p) => {
        panel = p;
      },
    };
    await handleConfigInteraction(interaction);
    const titre = panel.components[0].toJSON().components.find((c) => c.type === 10).content;
    assert.ok(titre.includes("Vue d'ensemble"), titre);
  });

  await cas("la vue d'ensemble reflète le VRAI état (anti-nuke désactivé -> avertissement listé)", () => {
    guardConfig.setEnabled("gsec", false);
    const texte = render("securityOverview", member);
    assert.ok(texte.includes("🟠") || texte.includes("🔴"), texte);
    assert.ok(texte.includes("Anti-nuke désactivé"), texte);
  });

  await cas("une fois l'anti-nuke réactivé, l'avertissement correspondant disparaît de la vue d'ensemble", () => {
    guardConfig.setEnabled("gsec", true);
    const texte = render("securityOverview", member);
    assert.ok(!texte.includes("Anti-nuke désactivé"), texte);
  });

  await cas("Protection, Anti-nuke et Mute restent trois écrans distincts avec leurs propres contrôles", () => {
    for (const section of ["protection", "guard", "mute"]) {
      const json = buildConfigPanel(guild, section, member).components[0].toJSON();
      const rangees = json.components.filter((c) => c.type === 1).length;
      assert.ok(rangees >= 2, `${section} doit garder ses propres contrôles, pas seulement la navigation`);
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
