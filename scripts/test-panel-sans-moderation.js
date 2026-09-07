/**
 * Verrouille le PÉRIMÈTRE de &panel : configuration du serveur uniquement —
 * sécurité, accueil/départ, tickets, giveaways, logs, sauvegardes, réglages du
 * bot. Sanctionner un membre ou lui donner un rôle n'y est plus proposé.
 *
 * Demande explicite : « dans le panel je vois y'a ajouter des rôles ou bannir
 * etc, je veux plus ça, le panel sert juste pour la sécurité les outils la
 * gestion de serveur ». Ces actions se font par commande, avec une mention ou
 * un identifiant — jamais via un sélecteur de membre.
 *
 * L'historique de modération, lui, RESTE : c'est de la consultation, pas une
 * action sur quelqu'un. Il vit sous Monitoring.
 *
 * Lancement : node scripts/test-panel-sans-moderation.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-sansmod-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, ID, SECTIONS } = require("../utils/configPanel");

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
  id: "g1",
  name: "test",
  ownerId: "owner-1",
  memberCount: 3,
  roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};
const owner = { id: "owner-1", guild: { id: "g1", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };

function composantsDe(section) {
  return buildConfigPanel(guild, section, owner)
    .components[0].toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((r) => r.components);
}

const CLES = SECTIONS.map((s) => s.key);

(async () => {
  console.log("&panel = configuration du serveur, pas sanction de membre :");

  await cas("plus aucune rubrique de recherche/sanction de membre", () => {
    assert.ok(!CLES.includes("modCenter"), `rubriques : ${CLES.join(", ")}`);
  });

  await cas("choisir un membre ne sert plus qu'à le CONFIGURER, jamais à le sanctionner", () => {
    // Type 5 = UserSelectMenu. Quelques écrans en gardent un légitimement :
    // dispenser quelqu'un du quota de nettoyage, lui donner un accès, filtrer
    // l'historique par modérateur. Ce sont des réglages et de la lecture — pas
    // « choisis une cible, puis frappe ».
    const CONFIGURATION = {
      moderation: "dispenses de nettoyage et d'accès aux salons",
      history: "filtrer l'historique par membre ou par modérateur",
      access: "qui a accès au panel",
      sys: "qui a le rang sys",
      banall: "qui a le droit de lancer un ban de masse",
      guard: "whitelist anti-nuke",
      protection: "exemptions d'AutoMod",
    };
    for (const section of CLES) {
      const selecteurs = composantsDe(section).filter((c) => c.type === 5);
      if (!selecteurs.length) continue;
      assert.ok(
        CONFIGURATION[section],
        `${section} propose de choisir un membre sans raison de configuration connue : ${selecteurs.map((c) => c.custom_id).join(", ")}`
      );
    }
  });

  await cas("aucune action de sanction ni d'attribution de rôle nulle part dans le panel", () => {
    const interdits = ["modaction", "modhistory", "modtarget"];
    for (const section of CLES) {
      for (const c of composantsDe(section)) {
        const valeurs = [c.custom_id, ...(c.options || []).map((o) => o.value)].filter(Boolean);
        for (const v of valeurs) {
          for (const mot of interdits) {
            assert.ok(!v.includes(mot), `${section} expose encore "${v}"`);
          }
        }
      }
    }
  });

  await cas("les anciens identifiants d'action ne répondent plus, même actionnés directement", async () => {
    // Un ancien message de panel encore affiché ne doit pas pouvoir bannir.
    for (const customId of [`${ID}:modaction:ban_member:123`, `${ID}:modtarget`, `${ID}:modhistory:123`]) {
      let reponse = null;
      await handleConfigInteraction({
        customId,
        values: ["123"],
        member: owner,
        guild,
        update: async (p) => {
          reponse = p;
          return {};
        },
        reply: async (p) => {
          reponse = p;
          return {};
        },
        followUp: async () => ({}),
      });
      assert.strictEqual(reponse, null, `${customId} ne doit plus rien déclencher`);
    }
  });

  console.log("\nCe que le panel DOIT continuer à offrir :");

  await cas("la configuration complète du serveur reste présente", () => {
    const labels = SECTIONS.map((s) => s.label);
    for (const attendu of [
      "Bienvenue",
      "Départ",
      "Tickets",
      "Giveaways",
      "Logs",
      "Protection",
      "Anti-nuke",
      "Vérification",
      "Rôles automatiques",
      "Sauvegardes",
      "Vocaux",
      "Sondages",
    ]) {
      assert.ok(labels.includes(attendu), `"${attendu}" a disparu du panel : ${labels.join(", ")}`);
    }
  });

  await cas("l'historique de modération reste consultable — c'est de la lecture, pas une sanction", () => {
    assert.ok(CLES.includes("history"), "l'historique doit rester accessible");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
