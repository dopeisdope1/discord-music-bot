/**
 * Vérifie que le résultat d'une commande lancée depuis une CARTE DE
 * FORMULAIRE remplace cette carte, au lieu d'ouvrir un second message
 * éphémère à côté d'elle (utils/fakeMessage.js + utils/commandForms.js).
 *
 * Demande explicite : « je veux que le premier screen soit directement
 * intégré dans le deuxième » — la carte « Rôle ajouté » arrivait dans un
 * message séparé pendant que le formulaire, lui, se remettait à blanc.
 *
 * Le point délicat couvert ici : une carte d'action est un simple PNG joint,
 * alors que la carte de formulaire est un message Components V2. Sur un tel
 * message tout l'affichage passe par des composants — une pièce jointe seule
 * n'y apparaîtrait pas — d'où l'enveloppe MediaGallery vérifiée plus bas.
 *
 * Lancement : node scripts/test-form-result-inline.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "form-inline-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { AttachmentBuilder } = require("discord.js");
const { fakeMessage, remplacerParLaReponse, aEteRemplace } = require("../utils/fakeMessage");

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

/** Interaction minimale : note ce qui est édité et ce qui part en éphémère. */
function fausseInteraction({ editReplyKo = false } = {}) {
  const i = {
    user: { id: "owner-1" },
    member: { id: "owner-1" },
    guild: { id: "g1" },
    channel: { id: "c1" },
    edits: [],
    suivis: [],
    editReply: async (p) => {
      if (editReplyKo) throw new Error("Missing Permissions");
      i.edits.push(p);
      return {};
    },
    followUp: async (p) => {
      i.suivis.push(p);
      return {};
    },
  };
  return i;
}

const carteAction = () => ({ files: [new AttachmentBuilder(Buffer.from("x"), { name: "role.png" })] });

(async () => {
  console.log("Résultat d'une commande lancée depuis une carte de formulaire :");

  await cas("sans marqueur, la réponse part en éphémère à côté (comportement d'origine, inchangé)", async () => {
    const i = fausseInteraction();
    await fakeMessage(i).reply({ content: "fait" });
    assert.strictEqual(i.edits.length, 0, "aucun message ne doit être remplacé");
    assert.strictEqual(i.suivis.length, 1, "la réponse doit partir en message séparé");
    assert.ok(!aEteRemplace(i));
  });

  await cas("avec le marqueur, la PREMIÈRE réponse remplace le message au lieu d'en créer un", async () => {
    const i = fausseInteraction();
    remplacerParLaReponse(i);
    await fakeMessage(i).reply(carteAction());
    assert.strictEqual(i.suivis.length, 0, "aucun message éphémère ne doit être créé");
    assert.strictEqual(i.edits.length, 1, "la carte de formulaire doit être remplacée");
    assert.ok(aEteRemplace(i), "le formulaire ne doit alors PAS être remis à blanc par-dessus");
  });

  await cas("la carte d'action est enveloppée en Components V2 — sinon elle ne s'afficherait pas", async () => {
    const i = fausseInteraction();
    remplacerParLaReponse(i);
    await fakeMessage(i).reply(carteAction());
    const envoye = i.edits[0];
    const conteneur = envoye.components[0].toJSON();
    assert.strictEqual(conteneur.type, 17, "un Container Components V2 doit envelopper l'image");
    const galerie = conteneur.components.find((c) => c.type === 12);
    assert.strictEqual(galerie.items[0].media.url, "attachment://role.png", "la galerie doit pointer vers la pièce jointe");
    assert.strictEqual(envoye.files[0].name, "role.png", "le fichier doit rester joint");
    assert.deepStrictEqual(envoye.attachments, [], "l'ancienne pièce jointe doit être remplacée, pas empilée");
  });

  await cas("une réponse DÉJÀ en Components V2 n'est pas ré-enveloppée", async () => {
    const i = fausseInteraction();
    remplacerParLaReponse(i);
    const dejaV2 = { components: [{ toJSON: () => ({ type: 17, components: [] }) }], flags: 32768 };
    await fakeMessage(i).reply(dejaV2);
    assert.strictEqual(i.edits[0].components.length, 1, "les composants d'origine doivent être conservés tels quels");
  });

  await cas("les réponses SUIVANTES repartent en éphémère, sans écraser le résultat affiché", async () => {
    const i = fausseInteraction();
    remplacerParLaReponse(i);
    const msg = fakeMessage(i);
    await msg.reply(carteAction());
    await msg.reply({ content: "note complémentaire" });
    assert.strictEqual(i.edits.length, 1, "seule la première réponse remplace le message");
    assert.strictEqual(i.suivis.length, 1, "la seconde doit partir à côté");
  });

  await cas("si le remplacement est refusé, la réponse part quand même en éphémère — jamais rien", async () => {
    // L'action a DÉJÀ été exécutée quand on répond : rester muet laisserait
    // croire qu'elle a échoué.
    const i = fausseInteraction({ editReplyKo: true });
    remplacerParLaReponse(i);
    await fakeMessage(i).reply(carteAction());
    assert.strictEqual(i.edits.length, 0);
    assert.strictEqual(i.suivis.length, 1, "le repli doit poster la réponse malgré l'échec du remplacement");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
