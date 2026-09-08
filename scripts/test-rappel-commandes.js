/**
 * Vérifie le RAPPEL DE FAMILLE (utils/familyHelp.js) : une commande tapée
 * seule qui ne peut pas tourner ainsi affiche ses variantes au lieu de ne
 * rien répondre.
 *
 * Demande explicite : « quand je fais &giveaway j'vois aussi quelle commande
 * giveaway je peux taper [...] car aller sur &help et aller chercher c'est
 * chiant ».
 *
 * Le garde-fou principal de ce fichier : le rappel doit rester SILENCIEUX
 * pour les commandes qui fonctionnent très bien sans argument. Sinon `&stats`
 * ou `&banlist` répondraient un mode d'emploi au lieu de faire leur travail —
 * une régression bien pire que le silence qu'on corrige.
 *
 * Lancement : node scripts/test-rappel-commandes.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rappel-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { buildFamilyCard, famillesDe, tourneSeule } = require("../utils/familyHelp");
const { CATEGORIES } = require("../utils/commandCatalog");
const { isImplemented } = require("../utils/implementedCommands");
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

const owner = { id: "owner-1", guild: { id: "g1", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
const ROLE_SIMPLE = "1546335998529642628";
const simple = {
  id: "membre-1",
  guild: { id: "g1", ownerId: "owner-1" },
  roles: { cache: new Collection([[ROLE_SIMPLE, { id: ROLE_SIMPLE }]]) },
  permissions: { has: () => false },
};

/** Tous les noms de commande dessinés sur la carte. */
const nomsDe = (carte) =>
  carte.components[0]
    .toJSON()
    .components.filter((c) => c.type === 10)
    .map((c) => c.content)
    .join("\n");

(async () => {
  console.log("Une commande tapée seule rappelle ses variantes :");

  await cas("&giveaway, qui ne répondait RIEN, liste maintenant start et reroll", () => {
    const { variantes } = famillesDe("giveaway", owner);
    const noms = variantes.map((c) => c.name);
    assert.ok(noms.some((n) => n.startsWith("giveaway start")), noms.join(" | "));
    assert.ok(noms.some((n) => n.startsWith("giveaway reroll")), noms.join(" | "));
    assert.ok(buildFamilyCard("giveaway", owner, "g1"), "une carte doit être produite");
  });

  await cas("&ban rappelle sa syntaxe ET les commandes voisines qu'on cherchait peut-être", () => {
    const { variantes, proches } = famillesDe("ban", owner);
    assert.deepStrictEqual(variantes.map((c) => c.name), ["ban <@membre|id> [raison]"], JSON.stringify(variantes.map((c) => c.name)));
    const nomsProches = proches.map((c) => c.name);
    for (const attendu of ["unban", "softban", "banall", "tempban", "banlist"]) {
      assert.ok(nomsProches.some((n) => n.startsWith(attendu)), `"${attendu}" manque : ${nomsProches.join(" | ")}`);
    }
  });

  await cas("la carte porte la SYNTAXE complète, avec le vrai préfixe — pas juste le nom", () => {
    const texte = require("../utils/familyHelp").buildFamilyCard("giveaway", owner, "g1", { sansImage: true });
    const contenu = nomsDe(texte);
    assert.ok(contenu.includes("&giveaway start <durée> <lot>"), contenu);
    assert.ok(/facultatif/.test(contenu), `la légende [ ] / < > doit être rappelée : ${contenu}`);
  });

  console.log("\nLe rappel ne parasite JAMAIS une commande qui marche :");

  await cas("&stats et &banlist tournent sans argument — aucun rappel ne doit s'interposer", () => {
    for (const mot of ["stats", "banlist", "server", "userinfo", "perms"]) {
      assert.strictEqual(buildFamilyCard(mot, owner, "g1"), null, `${mot} ne doit PAS être intercepté`);
    }
  });

  await cas("une commande inconnue ne produit rien — le préfixe & est partagé avec un autre bot", () => {
    assert.strictEqual(buildFamilyCard("nexistepas", owner, "g1"), null);
  });

  await cas("règle générale : toute commande capable de tourner seule reste intacte", () => {
    // Vérifié sur TOUT le catalogue, pas sur un échantillon : c'est la
    // garantie qui empêche une commande d'être avalée par le rappel au fil
    // des ajouts.
    for (const categorie of CATEGORIES) {
      for (const cmd of categorie.commands) {
        if (!isImplemented(cmd) || !cmd.prefix) continue;
        const mot = cmd.name.trim().split(/\s+/)[0].toLowerCase();
        if (!tourneSeule(cmd) || cmd.name.trim().includes(" ")) continue;
        assert.strictEqual(buildFamilyCard(mot, owner, "g1"), null, `${cmd.name} tourne seule et ne doit pas être interceptée`);
      }
    }
  });

  console.log("\nLe rappel respecte les droits réels :");

  await cas("un membre sans droits ne se voit jamais proposer une commande qu'il ne peut pas lancer", () => {
    permStore.setRoleGrants("g1", ROLE_SIMPLE, []);
    const { variantes, proches } = famillesDe("ban", simple);
    assert.deepStrictEqual(variantes, [], "aucune variante de ban n'est publique");
    assert.deepStrictEqual(proches, [], JSON.stringify(proches.map((c) => c.name)));
    assert.strictEqual(buildFamilyCard("ban", simple, "g1"), null, "sans droit, pas de carte du tout");
  });

  await cas("le droit accordé fait apparaître la commande, et elle seule", () => {
    permStore.setRoleGrants("g1", ROLE_SIMPLE, ["moderation.ban"]);
    const { variantes, proches } = famillesDe("ban", simple);
    assert.deepStrictEqual(variantes.map((c) => c.name), ["ban <@membre|id> [raison]"], JSON.stringify(variantes.map((c) => c.name)));
    // `&kick` n'a pas été accordé : il ne doit apparaître nulle part.
    const tout = [...variantes, ...proches].map((c) => c.name).join(" ");
    assert.ok(!tout.includes("kick"), tout);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
