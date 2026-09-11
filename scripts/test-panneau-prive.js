/**
 * Un panneau appartient à qui l'a ouvert (utils/messageOwner.js).
 *
 * LE PROBLÈME : `&panel` et les cartes de commande (`&addrole`, `&ban`…) sont
 * des messages PUBLICS. N'importe qui pouvait cliquer sur les menus de la
 * carte ouverte par quelqu'un d'autre — au minimum en la faisant changer sous
 * ses yeux, au pire en lançant une action à sa place s'il avait lui aussi le
 * droit correspondant.
 *
 * Les permissions ne couvrent pas ce cas : deux modérateurs ont exactement les
 * mêmes, et ce n'est pas une raison pour piloter le panneau de l'autre. Ce qui
 * manquait n'était pas une permission mais une notion de PROPRIÉTAIRE.
 *
 * Lancement : node scripts/test-panneau-prive.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "proprio-test-"));

const messageOwner = require("../utils/messageOwner");

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

const PROPRIO = "moi";
const AUTRE = "quelquun-dautre";

/**
 * @param {object} o
 * @param {string} [o.origine] message auquel le panneau répond
 * @param {object} [o.messages] messages retrouvables dans le salon
 */
function interaction(clic, { origine, messages = {}, messageId = "panneau-1" } = {}) {
  return {
    user: { id: clic },
    message: { id: messageId, reference: origine ? { messageId: origine } : null },
    channel: {
      messages: {
        fetch: async (id) => {
          if (!messages[id]) throw new Error("Unknown Message");
          return messages[id];
        },
      },
    },
  };
}

(async () => {
  console.log("Seul le propriétaire pilote son panneau :");

  await cas("celui qui a ouvert le panneau peut cliquer", async () => {
    messageOwner.reinitialiser();
    messageOwner.retenir("panneau-1", PROPRIO);
    const { autorise } = await messageOwner.verifier(interaction(PROPRIO));
    assert.strictEqual(autorise, true);
  });

  await cas("quelqu'un d'autre est REFUSÉ, et on sait à qui appartient le panneau", async () => {
    messageOwner.reinitialiser();
    messageOwner.retenir("panneau-1", PROPRIO);
    const { autorise, proprietaire } = await messageOwner.verifier(interaction(AUTRE));
    assert.strictEqual(autorise, false);
    assert.strictEqual(proprietaire, PROPRIO, "le message de refus doit pouvoir nommer le propriétaire");
  });

  await cas("`repondreEtRetenir` enregistre le propriétaire à l'envoi", async () => {
    messageOwner.reinitialiser();
    const message = { author: { id: PROPRIO }, reply: async () => ({ id: "envoye-1" }) };
    await messageOwner.repondreEtRetenir(message, { content: "panneau" });
    assert.strictEqual(messageOwner.proprietaireDe("envoye-1"), PROPRIO);
  });

  console.log("\nAprès un redémarrage, la protection se rétablit toute seule :");

  await cas("le propriétaire est retrouvé via le message auquel le panneau répond", async () => {
    // La mémoire est vide (redémarrage). Un panneau étant toujours une RÉPONSE
    // à la commande qui l'a ouvert, son auteur est le propriétaire.
    messageOwner.reinitialiser();
    const commande = { id: "commande-1", author: { id: PROPRIO } };
    const i = interaction(AUTRE, { origine: "commande-1", messages: { "commande-1": commande } });
    const { autorise, proprietaire } = await messageOwner.verifier(i);
    assert.strictEqual(autorise, false);
    assert.strictEqual(proprietaire, PROPRIO);
  });

  await cas("le propriétaire retrouvé est MIS EN CACHE — un seul appel réseau", async () => {
    messageOwner.reinitialiser();
    let appels = 0;
    const i = interaction(PROPRIO, { origine: "commande-1" });
    i.channel.messages.fetch = async () => {
      appels++;
      return { id: "commande-1", author: { id: PROPRIO } };
    };
    await messageOwner.verifier(i);
    await messageOwner.verifier(i);
    assert.strictEqual(appels, 1, `${appels} appels — le second devait être servi par le cache`);
  });

  console.log("\nEn dernier recours, on AUTORISE plutôt que de bloquer :");

  await cas("un panneau sans origine connue reste utilisable", async () => {
    // Message d'origine supprimé, cache vidé : refuser bloquerait la personne
    // légitime, alors que les permissions continuent de s'appliquer derrière.
    messageOwner.reinitialiser();
    const { autorise, proprietaire } = await messageOwner.verifier(interaction(AUTRE));
    assert.strictEqual(autorise, true);
    assert.strictEqual(proprietaire, null);
  });

  await cas("un message d'origine introuvable ne fait pas échouer la vérification", async () => {
    messageOwner.reinitialiser();
    const i = interaction(AUTRE, { origine: "supprime", messages: {} });
    const { autorise } = await messageOwner.verifier(i);
    assert.strictEqual(autorise, true, "une erreur de fetch ne doit pas bloquer");
  });

  console.log("\nLa mémoire reste bornée (le VPS n'a que 458 Mo) :");

  await cas("au-delà de la limite, le plus ancien panneau est oublié en premier", async () => {
    messageOwner.reinitialiser();
    for (let i = 0; i < messageOwner.MAX_ENTREES + 10; i++) messageOwner.retenir(`m${i}`, `u${i}`);
    assert.strictEqual(messageOwner.proprietaireDe("m0"), null, "le plus ancien devait être évincé");
    const dernier = `m${messageOwner.MAX_ENTREES + 9}`;
    assert.strictEqual(messageOwner.proprietaireDe(dernier), `u${messageOwner.MAX_ENTREES + 9}`);
  });

  console.log("\nLe garde couvre bien les deux panneaux concernés :");

  await cas("index.js protège `cfg:` (panel), les cartes de commande, le panel de protection perso ET \"&p\"", () => {
    // Vérifié dans la source : c'est un routage, il n'a pas d'autre point
    // d'observation. Les autres panneaux (ban, ban de masse, confirmations)
    // portent déjà leur propre contrôle d'auteur.
    const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    assert.ok(/PANNEAUX_PRIVES/.test(source), "le garde doit exister");
    assert.ok(
      /PANNEAUX_PRIVES = \["cfg:", `\$\{commandForms\.CARD_ID\}:`, `\$\{personalProtection\.CUSTOM_ID\}:`, `\$\{palierPanel\.CUSTOM_ID\}:`\]/.test(source),
      "les quatre préfixes doivent être couverts"
    );
    assert.ok(/messageOwner\.verifier\(interaction\)/.test(source), "la vérification doit être appelée");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
