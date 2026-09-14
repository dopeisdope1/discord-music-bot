/**
 * Anti-Cafard / Fuite Vocale / Anti-Stalker (protections personnelles,
 * "!!panel", utils/personalProtection.js) — se déclenchent quand quelqu'un
 * REJOINT un salon vocal TEMPORAIRE (voir utils/voiceChannels.js) :
 * Anti-Cafard expulse l'arrivant listé, Fuite Vocale fait partir le
 * propriétaire, Anti-Stalker alerte (jamais de sanction) un membre protégé
 * déjà présent quand un membre de sa liste de surveillance arrive.
 *
 * Lancement : node scripts/test-voice-blocklists.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-blocklists-test-"));

const { Collection } = require("discord.js");
const personalProtection = require("../utils/personalProtection");
const store = require("../utils/personalProtectionStore");
const lists = require("../utils/personalListsStore");
const voiceChannels = require("../utils/voiceChannels");

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

function fakeGuildState(guildId) {
  return { id: guildId };
}

function fakeMemberVoice(guild, id) {
  return {
    id,
    guild,
    user: { id, tag: `${id}#0000` },
    voice: {
      disconnect: async function (reason) {
        this._disconnected = reason;
      },
    },
  };
}

function fakeVoiceState(guild, channelId, member) {
  return { guild, channelId, member };
}

(async () => {
  console.log("Anti-Cafard (expulse un membre de la liste noire qui rejoint) :");

  await cas("un membre listé qui rejoint le salon du propriétaire est déconnecté", async () => {
    const guild = fakeGuildState("g1");
    voiceChannels.registerChannel("chan-1", "g1", "owner-1");
    store.toggle("g1", "owner-1", "antiCafard");
    lists.toggleInList("g1", "owner-1", "antiCafard", "indesirable-1");

    const arrivant = fakeMemberVoice(guild, "indesirable-1");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-1", arrivant);

    await personalProtection.enforceVoiceBlocklists(oldState, newState);
    assert.ok(arrivant.voice._disconnected);
  });

  await cas("un membre PAS dans la liste n'est jamais touché", async () => {
    const guild = fakeGuildState("g2");
    voiceChannels.registerChannel("chan-2", "g2", "owner-2");
    store.toggle("g2", "owner-2", "antiCafard");

    const arrivant = fakeMemberVoice(guild, "inconnu-2");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-2", arrivant);

    await personalProtection.enforceVoiceBlocklists(oldState, newState);
    assert.strictEqual(arrivant.voice._disconnected, undefined);
  });

  await cas("protection désactivée : même listé, rien ne se passe", async () => {
    const guild = fakeGuildState("g3");
    voiceChannels.registerChannel("chan-3", "g3", "owner-3");
    lists.toggleInList("g3", "owner-3", "antiCafard", "indesirable-3");
    // "antiCafard" jamais activé

    const arrivant = fakeMemberVoice(guild, "indesirable-3");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-3", arrivant);

    await personalProtection.enforceVoiceBlocklists(oldState, newState);
    assert.strictEqual(arrivant.voice._disconnected, undefined);
  });

  await cas("le propriétaire lui-même qui \"rejoint\" son propre salon n'est jamais visé", async () => {
    const guild = fakeGuildState("g4");
    voiceChannels.registerChannel("chan-4", "g4", "owner-4");
    store.toggle("g4", "owner-4", "antiCafard");
    lists.toggleInList("g4", "owner-4", "antiCafard", "owner-4");

    const proprietaire = fakeMemberVoice(guild, "owner-4");
    const oldState = fakeVoiceState(guild, null, proprietaire);
    const newState = fakeVoiceState(guild, "chan-4", proprietaire);

    await personalProtection.enforceVoiceBlocklists(oldState, newState);
    assert.strictEqual(proprietaire.voice._disconnected, undefined);
  });

  await cas("un salon vocal qui n'est PAS un salon temporaire n'est jamais concerné", async () => {
    const guild = fakeGuildState("g5");
    // aucun registerChannel pour "chan-5" — pas un salon temporaire
    const arrivant = fakeMemberVoice(guild, "quelconque-5");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-5", arrivant);

    await personalProtection.enforceVoiceBlocklists(oldState, newState);
    assert.strictEqual(arrivant.voice._disconnected, undefined);
  });

  console.log("\nFuite Vocale (le PROPRIÉTAIRE part si un membre de sa liste rejoint) :");

  await cas("le propriétaire est déconnecté quand un membre listé rejoint SON salon", async () => {
    const guild = fakeGuildState("g10");
    voiceChannels.registerChannel("chan-10", "g10", "owner-10");
    store.toggle("g10", "owner-10", "fuiteVocale");
    lists.toggleInList("g10", "owner-10", "fuiteVocale", "indesirable-10");

    const proprietaire = fakeMemberVoice(guild, "owner-10");
    guild.members = { fetch: async (id) => (id === "owner-10" ? proprietaire : null) };

    const arrivant = fakeMemberVoice(guild, "indesirable-10");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-10", arrivant);

    await personalProtection.enforceVoiceBlocklists(oldState, newState);
    assert.ok(proprietaire.voice._disconnected);
    assert.strictEqual(arrivant.voice._disconnected, undefined, "c'est le PROPRIÉTAIRE qui part, pas l'arrivant");
  });

  await cas("Anti-Cafard est prioritaire si les DEUX matchent à la fois (on règle plutôt que fuir)", async () => {
    const guild = fakeGuildState("g11");
    voiceChannels.registerChannel("chan-11", "g11", "owner-11");
    store.toggle("g11", "owner-11", "antiCafard");
    store.toggle("g11", "owner-11", "fuiteVocale");
    lists.toggleInList("g11", "owner-11", "antiCafard", "double-11");
    lists.toggleInList("g11", "owner-11", "fuiteVocale", "double-11");

    const proprietaire = fakeMemberVoice(guild, "owner-11");
    guild.members = { fetch: async (id) => (id === "owner-11" ? proprietaire : null) };
    const arrivant = fakeMemberVoice(guild, "double-11");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-11", arrivant);

    await personalProtection.enforceVoiceBlocklists(oldState, newState);
    assert.ok(arrivant.voice._disconnected, "Anti-Cafard doit s'appliquer");
    assert.strictEqual(proprietaire.voice._disconnected, undefined, "Fuite Vocale ne doit pas aussi se déclencher");
  });

  console.log("\nAnti-Stalker (alerte seule, jamais de sanction) :");

  function fakeChannelWithMembers(memberIds) {
    return { name: "salon-test", members: new Collection(memberIds.map((id) => [id, {}])) };
  }

  await cas("un membre surveillé déjà présent est alerté en MP quand la personne surveillée arrive", async () => {
    const guild = fakeGuildState("g20");
    store.toggle("g20", "protege-20", "antiStalker");
    lists.toggleInList("g20", "protege-20", "antiStalker", "surveille-20");

    const protege = { user: { send: async function (c) { this._dm = (this._dm || []); this._dm.push(c); return {}; } } };
    guild.members = { fetch: async (id) => (id === "protege-20" ? protege : null) };
    guild.channels = { cache: new Collection([["chan-20", fakeChannelWithMembers(["protege-20"])]]) };

    const arrivant = fakeMemberVoice(guild, "surveille-20");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-20", arrivant);

    await personalProtection.enforceStalkerAlert(oldState, newState);
    assert.strictEqual(protege.user._dm.length, 1);
  });

  await cas("aucune sanction : l'arrivant n'est jamais déconnecté par Anti-Stalker", async () => {
    const guild = fakeGuildState("g21");
    store.toggle("g21", "protege-21", "antiStalker");
    lists.toggleInList("g21", "protege-21", "antiStalker", "surveille-21");

    const protege = { user: { send: async () => ({}) } };
    guild.members = { fetch: async () => protege };
    guild.channels = { cache: new Collection([["chan-21", fakeChannelWithMembers(["protege-21"])]]) };

    const arrivant = fakeMemberVoice(guild, "surveille-21");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-21", arrivant);

    await personalProtection.enforceStalkerAlert(oldState, newState);
    assert.strictEqual(arrivant.voice._disconnected, undefined);
  });

  await cas("le membre protégé n'est PAS dans ce salon : aucune alerte", async () => {
    const guild = fakeGuildState("g22");
    store.toggle("g22", "protege-22", "antiStalker");
    lists.toggleInList("g22", "protege-22", "antiStalker", "surveille-22");

    const protege = { user: { send: async function (c) { this._dm = (this._dm || []); this._dm.push(c); return {}; } } };
    guild.members = { fetch: async () => protege };
    guild.channels = { cache: new Collection([["chan-22", fakeChannelWithMembers(["quelquun-dautre"])]]) };

    const arrivant = fakeMemberVoice(guild, "surveille-22");
    const oldState = fakeVoiceState(guild, null, arrivant);
    const newState = fakeVoiceState(guild, "chan-22", arrivant);

    await personalProtection.enforceStalkerAlert(oldState, newState);
    assert.strictEqual(protege.user._dm, undefined);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
