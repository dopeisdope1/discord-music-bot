/**
 * Vérifie les rubriques Statistiques et Diagnostics de la famille Monitoring
 * (module 9 de la refonte du panel) : chacune lit les MÊMES sources que la
 * commande texte correspondante (&stats/&stats history pour la première,
 * &status pour la seconde via computeStatus, déjà extrait au module 2) —
 * aucune donnée inventée, aucun chiffre recalculé différemment.
 *
 * Historique reste sous Modération (module 4) et il n'existe pas de rubrique
 * "Scan de sécurité" séparée (déjà couverte par Sécurité > Vue d'ensemble,
 * module 3) — ce fichier ne teste donc que Statistiques et Diagnostics.
 *
 * Lancement : node scripts/test-panel-monitoring.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-monitoring-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, buildSectionSpec } = require("../utils/configPanel");
const statsStore = require("../utils/statsStore");
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
  return {
    id: "gmon",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 250,
    roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection([["u1", { channelId: "vc1" }], ["u2", { channelId: "vc1" }]]) },
    client: { uptime: 3 * 3600_000 + 42_000, ws: { ping: 37 }, guilds: { cache: new Collection([["gmon", {}]]) }, kazagumo: { shoukaku: { nodes: [] } } },
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "gmon", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

/**
 * Tout ce qui s'affiche sur la rubrique : l'en-tête (texte Discord) et le
 * corps, qui est désormais DESSINÉ — on lit donc la spec passée au moteur de
 * rendu, la même donnée en structuré.
 */
function body(guild, section, member) {
  const entete = buildConfigPanel(guild, section, member).components[0].toJSON()
    .components.filter((c) => c.type === 10).map((c) => c.content);
  const spec = buildSectionSpec(guild, section, member);
  for (const carte of spec.cartes) {
    entete.push(carte.titre || "", carte.vide || "");
    // "libellé : valeur" sur une seule ligne, comme la carte les dessine :
    // les marqueurs `**` du markdown n'existent plus, ce sont des attributs
    // de rendu (taille, couleur), pas du texte.
    for (const item of carte.items) entete.push(item.description ? `${item.nom} : ${item.description}` : item.nom);
  }
  if (spec.pied) entete.push(spec.pied);
  return entete.join("\n");
}

(async () => {
  console.log("Monitoring — Statistiques et Diagnostics :");

  const guild = makeGuild();
  const today = new Date().toISOString().slice(0, 10);
  statsStore.record("gmon", "messages");
  statsStore.record("gmon", "joins");

  await cas("sans server.stats.view, Statistiques n'est pas proposée", () => {
    const noAccess = mkMember("u-none");
    const titre = buildConfigPanel(guild, "stats", noAccess).components[0].toJSON().components.find((c) => c.type === 10).content;
    assert.ok(!titre.includes("Statistiques"), titre);
  });

  await cas("avec server.stats.view, les compteurs serveur affichés sont les VRAIS (memberCount, vocal)", () => {
    permStore.setRoleGrants("gmon", "role-stats", ["server.stats.view"]);
    const member = mkMember("u-stats", "role-stats");
    const texte = body(guild, "stats", member);
    assert.ok(texte.includes("Membres : 250"), texte);
    assert.ok(texte.includes("en vocal : 2"), texte);
    assert.ok(texte.includes(today), texte);
  });

  await cas("sans le rang sys, Diagnostics n'est pas proposée (mêmes infos sensibles que &status)", () => {
    const noAccess = mkMember("u-none");
    const titre = buildConfigPanel(guild, "diagnostics", noAccess).components[0].toJSON().components.find((c) => c.type === 10).content;
    assert.ok(!titre.includes("Diagnostics"), titre);
  });

  await cas("avec le rang sys, Diagnostics affiche les VRAIES valeurs de computeStatus (uptime/latence/serveurs)", () => {
    const owner = { id: "owner-1", guild: { id: "gmon", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
    const texte = body(guild, "diagnostics", owner);
    assert.ok(texte.includes("37ms"), texte);
    assert.ok(texte.includes("3h"), texte);
    assert.ok(texte.includes("Serveurs : 1"), texte);
    assert.ok(texte.includes("aucun nœud déclaré"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
