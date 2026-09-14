/**
 * Sanctuaire Vocal (protection personnelle, "!!panel",
 * utils/personalProtection.js) — annule un DÉPLACEMENT forcé hors de SON
 * salon vocal temporaire. Écouteur dédié, séparé d'enforceMoveProtection :
 * la légitimité s'y résume à "est-ce moi qui l'ai fait" (jamais
 * estActionLegitime — même un modérateur avec de vrais droits n'a rien à
 * faire dans le salon de quelqu'un d'autre). Limité aux DÉPLACEMENTS :
 * Discord ne permet pas de reconnecter quelqu'un après une déconnexion
 * forcée, donc rien à annuler dans ce cas.
 *
 * Lancement : node scripts/test-sanctuaire-vocal.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sanctuaire-vocal-test-"));

const { Collection, AuditLogEvent } = require("discord.js");
const personalProtection = require("../utils/personalProtection");
const store = require("../utils/personalProtectionStore");
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

function fakeGuild(id, auditEntries = []) {
  return {
    id,
    fetchAuditLogs: async () => ({ entries: new Collection(auditEntries.map((e, i) => [`e${i}`, e])) }),
  };
}

function fakeMember(guild, id) {
  return {
    id,
    guild,
    voice: {
      setChannel: async function (channelId, reason) {
        this._movedTo = channelId;
        this._reason = reason;
      },
    },
  };
}

function auditEntry({ executorId, channelId, createdTimestamp = Date.now() }) {
  return { action: AuditLogEvent.MemberMove, executorId, extra: { channel: { id: channelId } }, createdTimestamp };
}

(async () => {
  console.log("Sanctuaire Vocal (voiceStateUpdate, déplacements uniquement) :");

  await cas("un déplacement forcé hors de SON salon temporaire est annulé", async () => {
    const guild = fakeGuild("g1", [auditEntry({ executorId: "mod-illegit-1", channelId: "chan-ailleurs-1" })]);
    voiceChannels.registerChannel("chan-sanctuaire-1", "g1", "owner-1");
    store.toggle("g1", "owner-1", "sanctuaireVocal");
    const proprietaire = fakeMember(guild, "owner-1");

    const oldState = { channelId: "chan-sanctuaire-1", member: proprietaire, guild };
    const newState = { channelId: "chan-ailleurs-1", member: proprietaire, guild };
    await personalProtection.enforceSanctuaryProtection(oldState, newState);
    assert.strictEqual(proprietaire.voice._movedTo, "chan-sanctuaire-1");
  });

  await cas("le propriétaire qui part DE SON PLEIN GRÉ (aucune entrée d'audit) n'est jamais ramené", async () => {
    const guild = fakeGuild("g2"); // aucune entrée d'audit
    voiceChannels.registerChannel("chan-sanctuaire-2", "g2", "owner-2");
    store.toggle("g2", "owner-2", "sanctuaireVocal");
    const proprietaire = fakeMember(guild, "owner-2");

    const oldState = { channelId: "chan-sanctuaire-2", member: proprietaire, guild };
    const newState = { channelId: "chan-ailleurs-2", member: proprietaire, guild };
    await personalProtection.enforceSanctuaryProtection(oldState, newState);
    assert.strictEqual(proprietaire.voice._movedTo, undefined);
  });

  await cas("un déplacement fait par le propriétaire lui-même (audit) n'est pas annulé", async () => {
    const guild = fakeGuild("g3", [auditEntry({ executorId: "owner-3", channelId: "chan-ailleurs-3" })]);
    voiceChannels.registerChannel("chan-sanctuaire-3", "g3", "owner-3");
    store.toggle("g3", "owner-3", "sanctuaireVocal");
    const proprietaire = fakeMember(guild, "owner-3");

    const oldState = { channelId: "chan-sanctuaire-3", member: proprietaire, guild };
    const newState = { channelId: "chan-ailleurs-3", member: proprietaire, guild };
    await personalProtection.enforceSanctuaryProtection(oldState, newState);
    assert.strictEqual(proprietaire.voice._movedTo, undefined);
  });

  await cas("un déplacement AILLEURS que dans son propre salon temporaire n'est pas concerné", async () => {
    const guild = fakeGuild("g4", [auditEntry({ executorId: "mod-illegit-4", channelId: "chan-ailleurs-4" })]);
    // "chan-normal-4" n'est PAS un salon temporaire enregistré comme celui de qui que ce soit
    store.toggle("g4", "quelquun-4", "sanctuaireVocal");
    const membre = fakeMember(guild, "quelquun-4");

    const oldState = { channelId: "chan-normal-4", member: membre, guild };
    const newState = { channelId: "chan-ailleurs-4", member: membre, guild };
    await personalProtection.enforceSanctuaryProtection(oldState, newState);
    assert.strictEqual(membre.voice._movedTo, undefined);
  });

  await cas("un déplacement hors de son salon par un AUTRE membre (pas le propriétaire) n'est pas concerné", async () => {
    const guild = fakeGuild("g5", [auditEntry({ executorId: "mod-illegit-5", channelId: "chan-ailleurs-5" })]);
    voiceChannels.registerChannel("chan-sanctuaire-5", "g5", "owner-5");
    store.toggle("g5", "invite-5", "sanctuaireVocal");
    const invite = fakeMember(guild, "invite-5"); // pas le propriétaire du salon

    const oldState = { channelId: "chan-sanctuaire-5", member: invite, guild };
    const newState = { channelId: "chan-ailleurs-5", member: invite, guild };
    await personalProtection.enforceSanctuaryProtection(oldState, newState);
    assert.strictEqual(invite.voice._movedTo, undefined);
  });

  await cas("protection désactivée : aucune action même avec un déplacement forcé détecté", async () => {
    const guild = fakeGuild("g6", [auditEntry({ executorId: "mod-illegit-6", channelId: "chan-ailleurs-6" })]);
    voiceChannels.registerChannel("chan-sanctuaire-6", "g6", "owner-6");
    // "sanctuaireVocal" jamais activé
    const proprietaire = fakeMember(guild, "owner-6");

    const oldState = { channelId: "chan-sanctuaire-6", member: proprietaire, guild };
    const newState = { channelId: "chan-ailleurs-6", member: proprietaire, guild };
    await personalProtection.enforceSanctuaryProtection(oldState, newState);
    assert.strictEqual(proprietaire.voice._movedTo, undefined);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
