/**
 * Vérifie la saisie des champs texte des cartes de commande
 * (utils/commandForms.js::collectTextFields) : depuis "&poll" (et toute
 * carte avec des champs texte), le bouton "Remplir dans le salon" ne doit
 * plus ouvrir de modale native Discord (popup gris, hors du style
 * Components V2 utilisé partout ailleurs — demande explicite de retirer ce
 * concept) mais demander chaque champ un par un dans le salon et attendre
 * la prochaine réponse de la personne.
 *
 * Les cartes dont TOUS les champs sont passés en menus déroulants (le
 * giveaway, voir scripts/test-giveaway-options.js) n'ont plus de bouton
 * "Remplir dans le salon" : leur saisie écrite se déclenche par l'option
 * "Autre" d'un menu, testée là-bas.
 *
 * Lancement : node scripts/test-text-capture.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "textcapture-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
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

function makeChannel(answers) {
  const queue = [...answers];
  const sent = [];
  return {
    send: async (content) => {
      sent.push(content);
      return {};
    },
    awaitMessages: async () => {
      const next = queue.shift();
      if (next === "__TIMEOUT__") throw new Error("time");
      // Une reponse peut etre un texte OU une piece jointe : `{ fichier: url }`
      // reproduit le message sans contenu qu'on obtient en deposant une image.
      const message =
        next && typeof next === "object" && next.fichier
          ? { author: { id: "owner-1" }, content: "", attachments: new Collection([["a1", { url: next.fichier }]]) }
          : { author: { id: "owner-1" }, content: next, attachments: new Collection() };
      return new Collection([["m1", message]]);
    },
    _sent: sent,
  };
}

function makeInteraction(formKey, channel) {
  const replies = [];
  let edited = null;
  return {
    user: { id: "owner-1" },
    member: { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() } },
    channel,
    customId: `${commandForms.CARD_ID}:textopen:${formKey}`,
    guild: { id: "g1" },
    client: {},
    // Presentes des lors que le formulaire complet s'EXECUTE : sans elles,
    // l'execution echouait sur `followUp is not a function` — ce qui prouvait
    // au passage que le correctif fonctionne.
    deferUpdate: async () => {},
    followUp: async (payload) => {
      replies.push(payload);
    },
    editReply: async (payload) => {
      replies.push(payload);
    },
    reply: async (payload) => {
      replies.push(payload);
    },
    message: {
      edit: async (payload) => {
        edited = payload;
      },
    },
    get _replies() {
      return replies;
    },
    get _edited() {
      return edited;
    },
  };
}

(async () => {
  console.log("Saisie des champs texte dans le salon (remplace la modale native) :");

  await cas("collecte les champs dans l'ordre pour poll_create", async () => {
    commandForms.clearFormState("owner-1", "poll_create");
    const channel = makeChannel(["Meilleur jeu ?", "Valorant", "LoL", "-"]);
    const interaction = makeInteraction("poll_create", channel);
    await commandForms.handleFormCardInteraction(interaction);

    const state = commandForms.getFormState("owner-1", "poll_create");
    assert.strictEqual(state.text.question, "Meilleur jeu ?");
    assert.strictEqual(state.text.option1, "Valorant");
    assert.ok(channel._sent[0].includes("Question"));
    assert.ok(channel._sent[1].includes("Option 1"));
  });

  await cas("aucune modale : la carte reste en Components V2, jamais de showModal", async () => {
    commandForms.clearFormState("owner-1", "poll_create");
    const channel = makeChannel(["Question ?", "A", "B", "-"]);
    const interaction = makeInteraction("poll_create", channel);
    assert.strictEqual(interaction.showModal, undefined);
    await commandForms.handleFormCardInteraction(interaction);
    assert.ok(interaction._edited?.flags !== undefined);
  });

  await cas("une vieille carte sans champ texte le dit au lieu de planter", async () => {
    const channel = makeChannel([]);
    const interaction = makeInteraction("giveaway_start", channel);
    await commandForms.handleFormCardInteraction(interaction);
    assert.ok(interaction._replies[0].content.includes("relance la commande"));
  });

  await cas("champ optionnel passé avec '-'", async () => {
    commandForms.clearFormState("owner-1", "poll_create");
    const channel = makeChannel(["Meilleur jeu ?", "Valorant", "LoL", "-"]);
    const interaction = makeInteraction("poll_create", channel);
    await commandForms.handleFormCardInteraction(interaction);

    const state = commandForms.getFormState("owner-1", "poll_create");
    assert.strictEqual(state.text.question, "Meilleur jeu ?");
    assert.strictEqual(state.text.option3, undefined);
  });

  await cas("la réponse est tronquée à la longueur maximum du champ", async () => {
    commandForms.clearFormState("owner-1", "role_color");
    const channel = makeChannel(["#ff0000mais bien trop long pour un hex"]);
    const interaction = makeInteraction("role_color", channel);
    await commandForms.handleFormCardInteraction(interaction);

    const state = commandForms.getFormState("owner-1", "role_color");
    assert.strictEqual(state.text.hex.length, 7);
  });

  await cas("un timeout conserve ce qui a déjà été rempli et libère la carte", async () => {
    commandForms.clearFormState("owner-1", "poll_create");
    const channel = makeChannel(["Question ?", "__TIMEOUT__"]);
    const interaction = makeInteraction("poll_create", channel);
    await commandForms.handleFormCardInteraction(interaction);

    const state = commandForms.getFormState("owner-1", "poll_create");
    assert.strictEqual(state.text.question, "Question ?");
    assert.strictEqual(state.text.option1, undefined);

    // La carte doit être de nouveau cliquable après le timeout, pas bloquée.
    const channel2 = makeChannel(["Valorant", "LoL", "-"]);
    const interaction2 = makeInteraction("poll_create", channel2);
    await commandForms.handleFormCardInteraction(interaction2);
    assert.strictEqual(interaction2._replies.length, 1);
    assert.ok(!interaction2._replies[0].content.includes("déjà en cours"));
  });

  await cas("un double-clic pendant une saisie en cours est refusé sans redémarrer la collecte", async () => {
    commandForms.clearFormState("owner-1", "poll_create");
    const slowChannel = {
      send: async () => ({}),
      awaitMessages: () => new Promise((resolve) => setTimeout(() => resolve(new Collection([["m1", { author: { id: "owner-1" }, content: "1h" }]])), 20)),
      _sent: [],
    };
    slowChannel.send = async (c) => {
      slowChannel._sent.push(c);
      return {};
    };
    const interactionA = makeInteraction("poll_create", slowChannel);
    const pending = commandForms.handleFormCardInteraction(interactionA);

    const interactionB = makeInteraction("poll_create", slowChannel);
    await commandForms.handleFormCardInteraction(interactionB);
    assert.ok(interactionB._replies[0].content.includes("déjà en cours"));

    await pending; // laisse la première saisie se terminer (timeout du test sinon)
  });

  console.log("\nRépondre en JOIGNANT un fichier vaut réponse :");

  await cas("&create : une image déposée remplit le champ du lien, et l'action PART", async () => {
    // Le cas signalé : la vidéo était jointe au message, donc `content` était
    // vide. Le champ restait vide, le formulaire n'était jamais complet, et le
    // bot répondait « Champs enregistrés » sans rien créer.
    //
    // On remplace `run` le temps du test : ce qui est vérifié ici, c'est la
    // VALEUR transmise à l'exécution, pas la création d'émoji elle-même (qui
    // demanderait un vrai serveur Discord).
    const form = commandForms.FORMS.create_emoji;
    const vrai = form.run;
    let recu = null;
    form.run = async (client, interaction, v) => {
      recu = v;
    };
    try {
      commandForms.clearFormState("owner-1", "create_emoji");
      const lien = "https://cdn.discordapp.com/attachments/1/2/bibendum.gif?ex=1&is=2&hm=abc";
      const channel = makeChannel([{ fichier: lien }, "oeoe"]);
      await commandForms.handleFormCardInteraction(makeInteraction("create_emoji", channel));

      assert.ok(recu, "le formulaire complet doit s'exécuter, pas s'arrêter à « Champs enregistrés »");
      assert.strictEqual(recu.text.url, lien, "le lien de la pièce jointe doit remplir le champ");
      assert.strictEqual(recu.text.name, "oeoe");
      assert.ok(
        channel._sent.some((m) => String(m).includes("C'est parti")),
        `le salon devait annoncer le lancement : ${channel._sent.join(" | ")}`
      );
      assert.ok(
        !channel._sent.some((m) => String(m).includes("Champs enregistrés")),
        "« Champs enregistrés » signifierait que rien n'a été lancé"
      );
    } finally {
      form.run = vrai;
    }
  });

  await cas("le formulaire est alors COMPLET — il part au lieu de dire « Champs enregistrés »", () => {
    const form = commandForms.FORMS.create_emoji;
    assert.strictEqual(form.ready({ text: { url: "https://x/y.gif", name: "oeoe" } }), true);
    // Sans le lien, il reste incomplet : c'est exactement ce qui se passait.
    assert.strictEqual(form.ready({ text: { url: "", name: "oeoe" } }), false);
  });

  await cas("un lien Discord signé n'est PAS tronqué — la signature deviendrait invalide", () => {
    const champ = commandForms.FORMS.create_emoji.textFields.find((f) => f.key === "url");
    // Un lien signé fait environ 260 caractères ; le couper renverrait 404.
    assert.ok(champ.max >= 400, `max=${champ.max} : trop court pour un lien signé`);
    assert.strictEqual(champ.fichier, true, "le champ doit accepter une pièce jointe");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
