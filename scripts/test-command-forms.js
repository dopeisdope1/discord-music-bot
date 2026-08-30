/**
 * Vérifie l'exécution de commandes depuis &panel > Exécuter
 * (utils/commandForms.js) : chaque formulaire construit un faux "message"
 * à partir des choix (salon/rôle/membre/texte) et appelle le VRAI handler
 * texte existant — ces tests vérifient que l'action réelle a bien lieu
 * (kick effectif, timeout à la bonne durée, message posté dans le bon
 * salon, rôle créé avec le bon nom...), pas seulement l'absence d'erreur.
 *
 * Lancement : node scripts/test-command-forms.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "commandforms-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField, ChannelType } = require("discord.js");
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

const TARGET_ID = "999888777000111222";

function makeInteraction() {
  const targetMember = {
    id: TARGET_ID,
    user: { id: TARGET_ID, tag: "cible#0001" },
    roles: { cache: new Collection(), highest: { position: 1 } },
    moderatable: true,
    communicationDisabledUntil: null,
    kick: async function (reason) {
      this._kicked = reason;
    },
    timeout: async function (ms, reason) {
      this._timedOut = { ms, reason };
    },
  };
  const membersCache = new Collection([[TARGET_ID, targetMember]]);
  const channel = {
    id: "c1",
    type: ChannelType.GuildText,
    send: async (payload) => {
      channel._sent = channel._sent || [];
      channel._sent.push(payload);
      return { id: "msg1", edit: async () => {} };
    },
  };
  const guild = {
    id: "g1",
    ownerId: "owner-x",
    channels: {
      cache: new Collection([["c1", channel]]),
      create: async (opts) => {
        guild._createdRole = opts;
        return { id: "newchan", name: opts.name };
      },
    },
    roles: {
      cache: new Collection(),
      everyone: { id: "g1" },
      create: async (opts) => {
        guild._createdRole = opts;
        return { id: "newrole", name: opts.name };
      },
    },
    members: {
      me: { id: "bot-1", permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } },
      fetch: async (id) => membersCache.get(id) || null,
      cache: membersCache,
    },
  };
  return {
    user: { id: "staff-1", tag: "staff#0001" },
    member: {
      id: "staff-1",
      guild,
      roles: { cache: new Collection(), highest: { position: 5 } },
      permissions: new PermissionsBitField(PermissionsBitField.All),
    },
    guild,
    channel,
    followUp: async () => ({}),
    _targetMember: targetMember,
    _channel: channel,
  };
}

const client = { user: { id: "bot-1", tag: "bot#0000" } };

(async () => {
  console.log("Exécution réelle depuis le panel :");

  await cas("kick_member expulse réellement la cible", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.kick_member.run(client, interaction, { userId: TARGET_ID, text: { reason: "spam" } });
    assert.strictEqual(interaction._targetMember._kicked, "spam");
  });

  await cas("timeout_member applique la bonne durée", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.timeout_member.run(client, interaction, { userId: TARGET_ID, text: { duration: "10m", reason: "test" } });
    assert.strictEqual(interaction._targetMember._timedOut.ms, 10 * 60 * 1000);
  });

  await cas("giveaway_start poste dans le salon choisi", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.giveaway_start.run(client, interaction, { channelId: "c1", text: { duration: "1h", prize: "Nitro" } });
    assert.ok(interaction._channel._sent?.length > 0);
  });

  await cas("poll_create poste la bonne question dans le salon choisi", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.poll_create.run(client, interaction, {
      channelId: "c1",
      text: { question: "Meilleur jeu ?", option1: "Valorant", option2: "LoL" },
    });
    const sent = interaction._channel._sent?.[0];
    const json = JSON.stringify(sent?.components?.[0]?.toJSON?.() || "");
    assert.ok(json.includes("Meilleur jeu"));
  });

  await cas("ticket_setup poste le message dans le salon choisi", async () => {
    const interaction = makeInteraction();
    interaction.guild.roles.cache.set("r1", { id: "r1", name: "Support" });
    await commandForms.FORMS.ticket_setup.run(client, interaction, { channelId: "c1", roleId: "r1" });
    assert.ok(interaction._channel._sent?.length > 0);
  });

  await cas("role_create crée un rôle avec le bon nom", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.role_create.run(client, interaction, { text: { name: "Testeur" } });
    assert.strictEqual(interaction.guild._createdRole?.name, "Testeur");
  });

  console.log("\nÉtat de formulaire (par utilisateur) :");

  await cas("setFormState fusionne sans écraser les autres champs texte", () => {
    commandForms.setFormState("u1", { formKey: "giveaway_start", text: { duration: "1h" } });
    commandForms.setFormState("u1", { text: { prize: "Nitro" } });
    const state = commandForms.getFormState("u1");
    assert.deepStrictEqual(state.text, { duration: "1h", prize: "Nitro" });
  });

  await cas("clearFormState efface bien l'état", () => {
    commandForms.clearFormState("u1");
    assert.strictEqual(commandForms.getFormState("u1"), null);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
