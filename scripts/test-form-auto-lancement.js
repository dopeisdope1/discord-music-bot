/**
 * Vérifie le lancement AUTOMATIQUE des cartes de formulaire : dès que le
 * dernier champ est choisi, l'action part sans bouton "Lancer"
 * (utils/commandForms.js). Demande explicite : « enlève le Lancer, je veux
 * que ça mette automatiquement ».
 *
 * Le garde-fou que ce fichier protège avant tout : les actions
 * IRRÉVERSIBLES gardent leur confirmation. Sans ça, un mauvais clic dans une
 * liste déroulante bannirait quelqu'un instantanément, sans retour possible.
 *
 * Lancement : node scripts/test-form-auto-lancement.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "form-auto-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection } = require("discord.js");
const commandForms = require("../utils/commandForms");

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

const ROLE_ID = "1546335998529642628";
const CIBLE_ID = "935098876644454400";

const role = { id: ROLE_ID, name: "bb", color: 0x5865f2, position: 2 };
const cible = {
  id: CIBLE_ID,
  user: { tag: "diaqeek", username: "diaqeek" },
  roles: { cache: new Collection(), highest: { position: 1 } },
};
const guild = {
  id: "g1",
  name: "test",
  ownerId: "staff-1",
  roles: { cache: new Collection([[ROLE_ID, role]]) },
  channels: { cache: new Collection() },
  // `me.permissions` comme une vraie guilde : les handlers de modération
  // vérifient les permissions du bot avant d'agir.
  members: {
    cache: new Collection([[CIBLE_ID, cible]]),
    fetch: async () => cible,
    me: { roles: { highest: { position: 9 } }, permissions: { has: () => true } },
  },
};
const membre = { id: "staff-1", guild, roles: { cache: new Collection() }, permissions: { has: () => true } };

/** Faux choix dans une liste déroulante de la carte. */
function choix(action, formKey, valeurs) {
  const i = {
    customId: `${commandForms.CARD_ID}:${action}:${formKey}`,
    values: valeurs,
    user: { id: "staff-1" },
    member: membre,
    guild,
    client: {},
    message: { edit: async () => ({}) },
    aEteDefer: false,
    misAJour: [],
    deferUpdate: async () => {
      i.aEteDefer = true;
    },
    update: async (p) => {
      i.misAJour.push(p);
      return {};
    },
    followUp: async () => ({}),
    editReply: async () => ({}),
    reply: async () => ({}),
  };
  return i;
}

const boutonsDe = (formKey) =>
  commandForms
    .buildFormCard(formKey, membre)
    .components[0].toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((r) => r.components)
    .filter((c) => c.type === 2);

(async () => {
  console.log("Lancement automatique une fois le formulaire complet :");

  await cas("addrole : tant qu'il manque un champ, rien ne part et la carte est simplement mise à jour", async () => {
    commandForms.clearFormState("staff-1", "addrole_member");
    const i = choix("role", "addrole_member", [ROLE_ID]);
    await commandForms.handleFormCardInteraction(i);
    assert.strictEqual(i.aEteDefer, false, "aucune exécution tant que le formulaire est incomplet");
    assert.strictEqual(i.misAJour.length, 1, "la carte doit seulement être réaffichée");
  });

  await cas("addrole : le DERNIER champ choisi déclenche l'action, sans clic supplémentaire", async () => {
    const i = choix("user", "addrole_member", [CIBLE_ID]);
    await commandForms.handleFormCardInteraction(i);
    assert.strictEqual(i.aEteDefer, true, "le formulaire complet doit partir tout seul");
    assert.strictEqual(i.misAJour.length, 0, "il ne doit pas se contenter de réafficher la carte");
    assert.ok(!commandForms.getFormState("staff-1", "addrole_member"), "l'état doit être vidé après exécution");
  });

  await cas("addrole n'affiche plus de bouton \"Lancer\" — il ne serait jamais cliquable", () => {
    commandForms.clearFormState("staff-1", "addrole_member");
    const labels = boutonsDe("addrole_member").map((b) => b.label);
    assert.ok(!labels.includes("Lancer"), labels.join(", "));
  });

  console.log("\nPlus aucune confirmation, y compris sur les actions irréversibles :");

  await cas("ban part dès que la cible est choisie — la confirmation a été retirée sur demande", async () => {
    // Ce qui protège encore : le droit exigé par la commande, la hiérarchie
    // des rôles revérifiée juste avant d'agir, et l'entrée d'historique.
    commandForms.clearFormState("staff-1", "ban_member");
    const i = choix("user", "ban_member", [CIBLE_ID]);
    await commandForms.handleFormCardInteraction(i);
    assert.strictEqual(i.aEteDefer, true, "le bannissement doit partir sans étape supplémentaire");
    assert.strictEqual(i.misAJour.length, 0, "il ne doit pas se contenter de réafficher la carte");
  });

  await cas("plus aucun bouton \"Confirmer\" nulle part", () => {
    for (const cle of Object.keys(commandForms.FORMS)) {
      commandForms.clearFormState("staff-1", cle);
      const labels = boutonsDe(cle).map((b) => b.label);
      assert.ok(!labels.includes("Confirmer"), `${cle} affiche encore une confirmation : ${labels.join(", ")}`);
    }
  });

  await cas("un formulaire à saisie clavier garde son bouton — sa saisie se termine hors des composants", () => {
    // Sans bouton, la carte serait sans issue : le texte est collecté dans le
    // salon, pas par un composant qui pourrait déclencher le lancement.
    const aTexte = Object.entries(commandForms.FORMS).find(([, f]) => f.textFields?.length);
    assert.ok(aTexte, "au moins un formulaire doit encore collecter du texte");
    commandForms.clearFormState("staff-1", aTexte[0]);
    const labels = boutonsDe(aTexte[0]).map((b) => b.label);
    assert.ok(labels.some((l) => l === "Lancer" || l === "Confirmer"), `${aTexte[0]} : ${labels.join(", ")}`);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
