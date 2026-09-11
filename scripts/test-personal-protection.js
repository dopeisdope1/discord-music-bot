/**
 * Panel de protection PERSONNELLE ("!!panel", utils/personalProtection.js).
 *
 * Volontairement sur un préfixe séparé de &panel (config serveur) pour ne
 * jamais se mélanger — demande explicite. V1 réduite à UNE protection,
 * Anti-Retrait Rôle : réapplique un rôle qu'on vient de retirer à un membre
 * qui a activé cette protection pour LUI-MÊME (aucun effet sur les autres).
 *
 * Lancement : node scripts/test-personal-protection.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "personal-protection-test-"));

const { Collection } = require("discord.js");
const personalProtection = require("../utils/personalProtection");
const store = require("../utils/personalProtectionStore");
const { getPrefixes } = require("../utils/prefixStore");

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

function fakeMessage(content, { authorId = "u1", guildId = "g1" } = {}) {
  const replies = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guild: { id: guildId },
    member: { id: authorId, guild: { id: guildId }, roles: { cache: new Collection() } },
    reply: async (p) => {
      const envoye = { id: `msg-${replies.length}`, ...p };
      replies.push(p);
      return envoye;
    },
    _replies: replies,
  };
}

(async () => {
  console.log("Préfixe dédié :");

  await cas("le préfixe par défaut est \"!!\", distinct de \"&\"", () => {
    const { protection, musicMod } = getPrefixes("g-quelconque");
    assert.strictEqual(protection, "!!");
    assert.notStrictEqual(protection, musicMod);
  });

  console.log("\n!!panel :");

  await cas("poste bien un panel Components V2", async () => {
    const msg = fakeMessage("!!panel");
    await personalProtection.handleProtectionTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(msg._replies[0].components?.length, "le panel doit avoir des components");
  });

  await cas("un mot inconnu sur ce préfixe reste silencieux", async () => {
    const msg = fakeMessage("!!nimportequoi");
    await personalProtection.handleProtectionTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("le préfixe & (modération) n'est pas concerné", async () => {
    const msg = fakeMessage("&panel");
    await personalProtection.handleProtectionTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log("\nBascule d'une protection :");

  await cas("un clic sur le bouton toggle active la protection pour CE membre", async () => {
    assert.strictEqual(store.isEnabled("g2", "u2", "antiRoleRemove"), false);
    const interaction = {
      customId: "prot:toggle:antiRoleRemove",
      guild: { id: "g2" },
      user: { id: "u2" },
      member: { id: "u2", guild: { id: "g2" }, roles: { cache: new Collection() } },
      update: async () => {},
    };
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(store.isEnabled("g2", "u2", "antiRoleRemove"), true);
  });

  await cas("n'affecte pas un autre membre du même serveur", async () => {
    assert.strictEqual(store.isEnabled("g2", "u3", "antiRoleRemove"), false);
  });

  console.log("\nAnti-Retrait Rôle en action :");

  // `guildRoleIds` reflète TOUS les rôles qui existent encore sur le serveur
  // (partagé entre avant/après) — distinct des rôles que LE MEMBRE possède.
  function fakeMember(id, guildRolesCache, memberRoleIds) {
    return {
      id,
      guild: { id: "g3", roles: { cache: guildRolesCache } },
      roles: {
        cache: new Collection(memberRoleIds.map((r) => [r, guildRolesCache.get(r)])),
        add: async function (roles) {
          this._ajoutes = Array.isArray(roles) ? roles : [roles];
        },
      },
    };
  }

  await cas("un rôle retiré est réappliqué si la protection est active", async () => {
    store.toggle("g3", "u4", "antiRoleRemove"); // -> true
    const guildRoles = new Collection([
      ["role-a", { id: "role-a" }],
      ["role-b", { id: "role-b" }],
    ]);
    const avant = fakeMember("u4", guildRoles, ["role-a", "role-b"]);
    const apres = fakeMember("u4", guildRoles, ["role-a"]); // role-b a disparu
    await personalProtection.enforceRoleProtection(avant, apres);
    assert.deepStrictEqual(
      apres.roles._ajoutes.map((r) => r.id),
      ["role-b"]
    );
  });

  await cas("rien ne se passe si la protection est désactivée", async () => {
    const guildRoles = new Collection([
      ["role-a", { id: "role-a" }],
      ["role-b", { id: "role-b" }],
    ]);
    const avant = fakeMember("u5", guildRoles, ["role-a", "role-b"]);
    const apres = fakeMember("u5", guildRoles, ["role-a"]);
    await personalProtection.enforceRoleProtection(avant, apres);
    assert.strictEqual(apres.roles._ajoutes, undefined, "aucun rôle ne devait être réappliqué");
  });

  await cas("aucune action si aucun rôle n'a été retiré", async () => {
    store.toggle("g3", "u6", "antiRoleRemove"); // -> true
    const guildRoles = new Collection([
      ["role-a", { id: "role-a" }],
      ["role-c", { id: "role-c" }],
    ]);
    const avant = fakeMember("u6", guildRoles, ["role-a"]);
    const apres = fakeMember("u6", guildRoles, ["role-a", "role-c"]); // ajout, pas retrait
    await personalProtection.enforceRoleProtection(avant, apres);
    assert.strictEqual(apres.roles._ajoutes, undefined);
  });

  await cas("un rôle supprimé du serveur entre-temps n'est pas réappliqué (plus dans le cache serveur)", async () => {
    store.toggle("g3", "u7", "antiRoleRemove"); // -> true
    const guildRoles = new Collection([
      ["role-a", { id: "role-a" }],
      ["role-supprime", { id: "role-supprime" }],
    ]);
    const avant = fakeMember("u7", guildRoles, ["role-a", "role-supprime"]);
    guildRoles.delete("role-supprime"); // le rôle n'existe plus du tout sur le serveur
    const apres = fakeMember("u7", guildRoles, ["role-a"]);
    await personalProtection.enforceRoleProtection(avant, apres);
    assert.strictEqual(apres.roles._ajoutes, undefined, "un rôle qui n'existe plus ne doit pas être réappliqué");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
