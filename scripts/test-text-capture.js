/**
 * Vérifie la saisie des champs texte des cartes de commande
 * (utils/commandForms.js::collectTextFields) : depuis "&giveaway" (et toute
 * carte avec des champs texte), le bouton "Remplir dans le salon" ne doit
 * plus ouvrir de modale native Discord (popup gris, hors du style
 * Components V2 utilisé partout ailleurs — demande explicite de retirer ce
 * concept) mais demander chaque champ un par un dans le salon et attendre
 * la prochaine réponse de la personne.
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
      return new Collection([["m1", { author: { id: "owner-1" }, content: next }]]);
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

  await cas("collecte les deux champs dans l'ordre pour giveaway_start", async () => {
    commandForms.clearFormState("owner-1", "giveaway_start");
    const channel = makeChannel(["1h", "Nitro"]);
    const interaction = makeInteraction("giveaway_start", channel);
    await commandForms.handleFormCardInteraction(interaction);

    const state = commandForms.getFormState("owner-1", "giveaway_start");
    assert.strictEqual(state.text.duration, "1h");
    assert.strictEqual(state.text.prize, "Nitro");
    assert.ok(channel._sent[0].includes("Durée"));
    assert.ok(channel._sent[1].includes("Lot"));
  });

  await cas("aucune modale : la carte reste en Components V2, jamais de showModal", async () => {
    commandForms.clearFormState("owner-1", "giveaway_start");
    const channel = makeChannel(["30m", "Un rôle"]);
    const interaction = makeInteraction("giveaway_start", channel);
    assert.strictEqual(interaction.showModal, undefined);
    await commandForms.handleFormCardInteraction(interaction);
    assert.ok(interaction._edited?.flags !== undefined);
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
    commandForms.clearFormState("owner-1", "giveaway_start");
    const channel = makeChannel(["2h", "__TIMEOUT__"]);
    const interaction = makeInteraction("giveaway_start", channel);
    await commandForms.handleFormCardInteraction(interaction);

    const state = commandForms.getFormState("owner-1", "giveaway_start");
    assert.strictEqual(state.text.duration, "2h");
    assert.strictEqual(state.text.prize, undefined);

    // La carte doit être de nouveau cliquable après le timeout, pas bloquée.
    const channel2 = makeChannel(["Nitro"]);
    const interaction2 = makeInteraction("giveaway_start", channel2);
    await commandForms.handleFormCardInteraction(interaction2);
    assert.strictEqual(interaction2._replies.length, 1);
    assert.ok(!interaction2._replies[0].content.includes("déjà en cours"));
  });

  await cas("un double-clic pendant une saisie en cours est refusé sans redémarrer la collecte", async () => {
    commandForms.clearFormState("owner-1", "giveaway_start");
    const slowChannel = {
      send: async () => ({}),
      awaitMessages: () => new Promise((resolve) => setTimeout(() => resolve(new Collection([["m1", { author: { id: "owner-1" }, content: "1h" }]])), 20)),
      _sent: [],
    };
    slowChannel.send = async (c) => {
      slowChannel._sent.push(c);
      return {};
    };
    const interactionA = makeInteraction("giveaway_start", slowChannel);
    const pending = commandForms.handleFormCardInteraction(interactionA);

    const interactionB = makeInteraction("giveaway_start", slowChannel);
    await commandForms.handleFormCardInteraction(interactionB);
    assert.ok(interactionB._replies[0].content.includes("déjà en cours"));

    await pending; // laisse la première saisie se terminer (timeout du test sinon)
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
