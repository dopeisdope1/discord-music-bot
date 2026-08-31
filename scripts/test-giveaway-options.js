/**
 * Vérifie les options de giveaway ajoutées à la carte interactive
 * (utils/commandForms.js) et au backend (utils/giveaways.js) : durée, lot et
 * nombre de gagnants en MENUS DÉROULANTS avec une option "Autre" qui rebascule
 * sur la saisie écrite, plus le tirage multi-gagnants et le rôle requis pour
 * participer.
 *
 * Lancement : node scripts/test-giveaway-options.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "giveaway-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField } = require("discord.js");
const commandForms = require("../utils/commandForms");
const giveaways = require("../utils/giveaways");
const giveawayStore = require("../utils/giveawayStore");

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

const STAFF = "staff-1";
const ROLE_ID = "role-999888777666555";

const member = () => ({
  id: STAFF,
  guild: { id: "g1" },
  roles: { cache: new Collection(), highest: { position: 5 } },
  permissions: new PermissionsBitField(PermissionsBitField.All),
});

/** Composants du container de la carte, en JSON brut. */
function cardComponents(key) {
  return commandForms.buildFormCard(key, member()).components[0].toJSON().components;
}

function selectFor(key, fieldKey) {
  const row = cardComponents(key).find((c) => c.type === 1 && c.components[0].custom_id === `cmdrun:choice:${key}:${fieldKey}`);
  return row?.components[0] || null;
}

const summaryOf = (key) => cardComponents(key).find((c) => c.type === 10 && c.content.includes(">")).content;

/** Faux salon qui enregistre ce qui y est envoyé et sait répondre à awaitMessages. */
function fakeChannel({ answers = [] } = {}) {
  const queue = [...answers];
  return {
    id: "c1",
    _sent: [],
    isTextBased: () => true,
    send: async function (payload) {
      this._sent.push(payload);
      return { id: "gw-msg", edit: async () => {} };
    },
    awaitMessages: async () => {
      if (!queue.length) throw new Error("time");
      return new Collection([["m", { content: queue.shift() }]]);
    },
    messages: { fetch: async () => ({ edit: async () => {} }) },
  };
}

function fakeInteraction(customId, values, channel) {
  const m = member();
  return {
    customId,
    values,
    user: { id: STAFF, tag: "staff#0001" },
    member: m,
    guild: { id: "g1", channels: { cache: new Collection([["c1", channel]]) }, roles: { cache: new Collection() } },
    channel,
    message: { edit: async () => {} },
    _replies: [],
    reply: async function (p) {
      this._replies.push(p);
      return {};
    },
    update: async function (p) {
      this._updated = p;
      return {};
    },
    followUp: async () => ({}),
  };
}

(async () => {
  console.log("Menus déroulants de la carte giveaway :");

  commandForms.clearFormState(STAFF, "giveaway_start");

  await cas("la durée est un menu déroulant, plus un champ à taper", () => {
    const select = selectFor("giveaway_start", "duration");
    assert.ok(select, "un menu déroulant `duration` doit exister");
    const values = select.options.map((o) => o.value);
    for (const attendu of ["1m", "30m", "1h", "6h", "12h", "1d", "3d", "7d"]) {
      assert.ok(values.includes(attendu), `la durée ${attendu} doit être proposée`);
    }
  });

  await cas("toutes les durées proposées sont réellement comprises par le bot", () => {
    const { parseDuration } = require("../utils/moderationCommands");
    for (const o of selectFor("giveaway_start", "duration").options) {
      if (o.value === "__autre__") continue;
      assert.ok(parseDuration(o.value), `la durée « ${o.value} » doit être analysable`);
    }
  });

  await cas("le lot et le nombre de gagnants ont aussi leur menu", () => {
    assert.ok(selectFor("giveaway_start", "prize"), "menu `prize` attendu");
    const winners = selectFor("giveaway_start", "winners");
    assert.ok(winners, "menu `winners` attendu");
    assert.ok(winners.options.some((o) => o.value === "10"), "on doit pouvoir tirer jusqu'à 10 gagnants");
  });

  await cas("chaque menu garde une option « Autre » pour écrire soi-même", () => {
    for (const field of ["duration", "prize", "winners"]) {
      const options = selectFor("giveaway_start", field).options;
      assert.ok(options.some((o) => o.value === "__autre__"), `le champ ${field} doit garder une sortie à l'écrit`);
    }
  });

  await cas("choisir une valeur dans la liste la retient et la coche", async () => {
    const interaction = fakeInteraction("cmdrun:choice:giveaway_start:duration", ["6h"], fakeChannel());
    await commandForms.handleFormCardInteraction(interaction);
    assert.strictEqual(commandForms.getFormState(STAFF, "giveaway_start").text.duration, "6h");
    const chosen = selectFor("giveaway_start", "duration").options.find((o) => o.value === "6h");
    assert.strictEqual(chosen.default, true, "l'option retenue doit rester cochée à l'ouverture suivante");
    assert.ok(summaryOf("giveaway_start").includes("6h"));
  });

  await cas("« Autre » redemande le champ à l'écrit et écrase la valeur choisie avant", async () => {
    const channel = fakeChannel({ answers: ["45m"] });
    const interaction = fakeInteraction("cmdrun:choice:giveaway_start:duration", ["__autre__"], channel);
    await commandForms.handleFormCardInteraction(interaction);
    assert.strictEqual(commandForms.getFormState(STAFF, "giveaway_start").text.duration, "45m");
    assert.ok(channel._sent.some((m) => String(m).includes("Durée personnalisée")), "la question posée doit être celle du champ");
  });

  await cas("« Autre » ne redemande QUE ce champ, pas tout le formulaire", async () => {
    commandForms.setFormState(STAFF, "giveaway_start", { text: { duration: "1h", prize: "Nitro (1 mois)" } });
    const channel = fakeChannel({ answers: ["Un clavier"] });
    await commandForms.handleFormCardInteraction(fakeInteraction("cmdrun:choice:giveaway_start:prize", ["__autre__"], channel));
    const state = commandForms.getFormState(STAFF, "giveaway_start");
    assert.strictEqual(state.text.prize, "Un clavier");
    assert.strictEqual(state.text.duration, "1h", "la durée déjà choisie ne doit pas être redemandée");
    const questions = channel._sent.filter((m) => String(m).includes("**")).length;
    assert.strictEqual(questions, 1, "une seule question doit être posée");
  });

  await cas("le rôle est présenté comme un filtre de participation, et facultatif", () => {
    const roleRow = cardComponents("giveaway_start").find((c) => c.type === 1 && c.components[0].custom_id === "cmdrun:role:giveaway_start");
    assert.ok(roleRow, "un sélecteur de rôle doit exister");
    assert.strictEqual(roleRow.components[0].min_values, 0, "on doit pouvoir n'en choisir aucun");
    assert.ok(summaryOf("giveaway_start").includes("participer"));
  });

  await cas("la carte reste sous la limite de composants d'un container Discord", () => {
    assert.ok(cardComponents("giveaway_start").length <= 10, "un Container accepte 10 composants au maximum");
  });

  console.log("\nTirage multi-gagnants (utils/giveaways.js) :");

  await cas("tire le nombre demandé de gagnants, tous différents", () => {
    const winners = giveaways.pickWinners(["a", "b", "c", "d", "e"], 3);
    assert.strictEqual(winners.length, 3);
    assert.strictEqual(new Set(winners).size, 3, "la même personne ne peut pas gagner deux fois");
  });

  await cas("ne tire pas plus de gagnants qu'il n'y a de participants", () => {
    assert.strictEqual(giveaways.pickWinners(["a", "b"], 5).length, 2);
    assert.strictEqual(giveaways.pickWinners([], 3).length, 0);
  });

  await cas("un giveaway sans nombre de gagnants reste à un seul gagnant", () => {
    assert.strictEqual(giveaways.pickWinners(["a", "b", "c"]).length, 1);
  });

  console.log("\nPersistance et compatibilité :");

  await cas("le nombre de gagnants et le rôle requis sont bien enregistrés", () => {
    giveawayStore.create({
      messageId: "gw-1",
      guildId: "g1",
      channelId: "c1",
      prize: "Nitro",
      endsAt: Date.now() + 1000,
      hostId: STAFF,
      winnersCount: 3,
      requiredRoleId: ROLE_ID,
    });
    const stored = giveawayStore.get("gw-1");
    assert.strictEqual(stored.winnersCount, 3);
    assert.strictEqual(stored.requiredRoleId, ROLE_ID);
  });

  await cas("markEnded retient tous les gagnants, et reste lisible par l'ancien champ", () => {
    giveawayStore.markEnded("gw-1", ["u1", "u2", "u3"]);
    const stored = giveawayStore.get("gw-1");
    assert.deepStrictEqual(stored.winnerIds, ["u1", "u2", "u3"]);
    assert.strictEqual(stored.winnerId, "u1", "le champ d'avant le multi-gagnant doit rester renseigné");
  });

  await cas("un giveaway enregistré AVANT le multi-gagnant reste lisible", () => {
    assert.deepStrictEqual(giveaways.winnersOf({ winnerId: "ancien" }), ["ancien"]);
    assert.deepStrictEqual(giveaways.winnersOf({ winnerIds: ["a", "b"] }), ["a", "b"]);
    assert.deepStrictEqual(giveaways.winnersOf({ winnerId: null }), []);
  });

  console.log("\nRôle requis pour participer :");

  const joinInteraction = (roleIds) => ({
    customId: "giveaway:join",
    user: { id: "participant-1" },
    member: { id: "participant-1", roles: { cache: new Collection(roleIds.map((r) => [r, { id: r }])) } },
    message: { id: "gw-2", edit: async () => {} },
    _replies: [],
    reply: async function (p) {
      this._replies.push(p);
      return {};
    },
  });

  await cas("un membre sans le rôle requis est refusé et n'est pas inscrit", async () => {
    giveawayStore.create({
      messageId: "gw-2",
      guildId: "g1",
      channelId: "c1",
      prize: "Nitro",
      endsAt: Date.now() + 60000,
      hostId: STAFF,
      winnersCount: 1,
      requiredRoleId: ROLE_ID,
    });
    const interaction = joinInteraction([]);
    await giveaways.handleGiveawayButton(interaction);
    assert.ok(interaction._replies[0].content.includes("réservé"));
    assert.strictEqual(giveawayStore.get("gw-2").participants.length, 0);
  });

  await cas("le même membre passe une fois le rôle obtenu", async () => {
    const interaction = joinInteraction([ROLE_ID]);
    await giveaways.handleGiveawayButton(interaction);
    assert.deepStrictEqual(giveawayStore.get("gw-2").participants, ["participant-1"]);
  });

  await cas("sans rôle requis, tout le monde peut participer", async () => {
    giveawayStore.create({
      messageId: "gw-3",
      guildId: "g1",
      channelId: "c1",
      prize: "Nitro",
      endsAt: Date.now() + 60000,
      hostId: STAFF,
    });
    const interaction = joinInteraction([]);
    interaction.message.id = "gw-3";
    await giveaways.handleGiveawayButton(interaction);
    assert.deepStrictEqual(giveawayStore.get("gw-3").participants, ["participant-1"]);
  });

  console.log("\nLancement depuis la carte :");

  await cas("le formulaire transmet durée, lot, gagnants et rôle au vrai backend", async () => {
    const channel = fakeChannel();
    const interaction = fakeInteraction("cmdrun:launch:giveaway_start", [], channel);
    await commandForms.FORMS.giveaway_start.run({ user: { id: "bot" } }, interaction, {
      channelId: "c1",
      roleId: ROLE_ID,
      text: { duration: "1h", prize: "Un clavier", winners: "3" },
    });
    const created = Object.values(JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "giveaways.json"), "utf8"))).find((g) => g.prize === "Un clavier");
    assert.ok(created, "le giveaway doit avoir été créé");
    assert.strictEqual(created.winnersCount, 3);
    assert.strictEqual(created.requiredRoleId, ROLE_ID);
  });

  await cas("sans choix de gagnants, on retombe sur un seul gagnant", async () => {
    const channel = fakeChannel();
    const interaction = fakeInteraction("cmdrun:launch:giveaway_start", [], channel);
    await commandForms.FORMS.giveaway_start.run({ user: { id: "bot" } }, interaction, {
      channelId: "c1",
      text: { duration: "1h", prize: "Lot simple" },
    });
    const created = Object.values(JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "giveaways.json"), "utf8"))).find((g) => g.prize === "Lot simple");
    assert.strictEqual(created.winnersCount, 1);
    assert.strictEqual(created.requiredRoleId, null);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
