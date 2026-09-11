/**
 * Vérifie &perms/&helpall (utils/permsCommands.js) : les rôles ayant
 * EXACTEMENT le même ensemble de permissions accordées sont regroupés sous
 * le même palier numéroté (du plus petit ensemble au plus grand), &perms
 * liste les commandes débloquées par palier, &helpall liste les rôles.
 * Toujours calculé depuis le système existant (utils/permissions/store.js)
 * — aucun nouveau modèle de données, juste une présentation groupée.
 *
 * Lancement : node scripts/test-perms-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "permscmd-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const permStore = require("../utils/permissions/store");
const { perms, helpall, computeTiers, buildTierCard, LIMITE_COMPOSANT } = require("../utils/permsCommands");

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

function fakeMessage(guildId) {
  const replies = [];
  return {
    member: { id: "owner-1", guild: { id: guildId }, roles: { cache: new Collection() } },
    guild: { id: guildId },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("Regroupement par ensemble de permissions identique :");

  await cas("deux rôles avec les mêmes clés partagent le même palier", () => {
    permStore.setRoleGrants("g1", "role-A", ["moderation.kick"]);
    permStore.setRoleGrants("g1", "role-B", ["moderation.kick"]);
    permStore.setRoleGrants("g1", "role-C", ["moderation.kick", "moderation.ban", "members.role"]);

    const tiers = computeTiers("g1");
    assert.strictEqual(tiers.length, 2);
    assert.deepStrictEqual(new Set(tiers[0].roleIds), new Set(["role-A", "role-B"]));
    assert.deepStrictEqual(tiers[1].roleIds, ["role-C"]);
  });

  await cas("les paliers sont triés du plus petit ensemble au plus grand", () => {
    const tiers = computeTiers("g1");
    assert.ok(tiers[0].keys.length < tiers[1].keys.length);
  });

  console.log("\n&perms — commandes par palier :");

  await cas("liste les commandes réellement débloquées par la clé accordée", async () => {
    const msg = fakeMessage("g1");
    await perms(null, msg);
    const body = msg._replies[0].components[0].toJSON().components[2].content;
    assert.ok(body.includes("kick"));
    assert.ok(body.includes("Permission 1"));
    assert.ok(body.includes("Permission 2"));
  });

  await cas("message informatif si aucune permission accordée sur le serveur", async () => {
    const msg = fakeMessage("g-vide");
    await perms(null, msg);
    assert.ok(msg._replies[0].embeds?.[0]?.data?.description?.includes("Aucune permission"));
  });

  console.log("\n&helpall — rôles par palier :");

  await cas("liste bien les DEUX rôles regroupés sous le même palier", async () => {
    const msg = fakeMessage("g1");
    await helpall(null, msg);
    const body = msg._replies[0].components[0].toJSON().components[2].content;
    assert.ok(body.includes("<@&role-A>") && body.includes("<@&role-B>"));
    assert.ok(body.includes("<@&role-C>"));
  });

  console.log("\nRôles \"exclusifs\" (&panel > Permissions) — section à part, sous les paliers :");

  await cas("un rôle marqué exclusif apparaît dans une section \"Exclusives\" sur &perms ET &helpall", async () => {
    permStore.setRoleExclusive("g1", "role-C", true);

    const msgPerms = fakeMessage("g1");
    await perms(null, msgPerms);
    const bodyPerms = msgPerms._replies[0].components[0].toJSON().components[2].content;
    assert.ok(bodyPerms.includes("Exclusives"), bodyPerms);
    assert.ok(bodyPerms.includes("<@&role-C>"), bodyPerms);

    const msgHelpall = fakeMessage("g1");
    await helpall(null, msgHelpall);
    const bodyHelpall = msgHelpall._replies[0].components[0].toJSON().components[2].content;
    assert.ok(bodyHelpall.includes("Exclusives"), bodyHelpall);
    assert.ok(bodyHelpall.includes("<@&role-C>"), bodyHelpall);
  });

  await cas("un rôle exclusif n'apparaît QU'une fois — plus sous un \"Permission N\" numéroté", async () => {
    // role-C était seul sur son palier ("Permission 2") avant d'être marqué
    // exclusif : signalé — il continuait à s'afficher aux deux endroits.
    const msg = fakeMessage("g1");
    await helpall(null, msg);
    const json = msg._replies[0].components[0].toJSON();
    const body = json.components[2].content;
    const exclusivesIndex = body.indexOf("Exclusives");
    const beforeExclusives = body.slice(0, exclusivesIndex);
    assert.ok(!beforeExclusives.includes("<@&role-C>"), `role-C ne doit apparaître QUE dans "Exclusives" :\n${body}`);
    assert.ok(!beforeExclusives.includes("Permission 2"), "le palier qui ne contenait QUE role-C doit disparaître entièrement une fois vide");
  });

  await cas("plusieurs rôles exclusifs sont tous listés", async () => {
    permStore.setRoleExclusive("g1", "role-A", true);
    const msg = fakeMessage("g1");
    await helpall(null, msg);
    const body = msg._replies[0].components[0].toJSON().components[2].content;
    assert.ok(body.includes("<@&role-A>") && body.includes("<@&role-C>"));
    permStore.setRoleExclusive("g1", "role-A", false);
  });

  await cas("un serveur SANS permission accordée mais avec un rôle exclusif affiche quand même la carte", async () => {
    permStore.setRoleExclusive("g-vide-exclusif", "role-solo", true);
    const msg = fakeMessage("g-vide-exclusif");
    await perms(null, msg);
    assert.ok(!msg._replies[0].embeds, "ce n'est plus le message \"Aucune permission\"");
    const body = msg._replies[0].components[0].toJSON().components[2].content;
    assert.ok(body.includes("Exclusives"));
    assert.ok(body.includes("<@&role-solo>"));
  });

  await cas("retirer l'exclusivité fait disparaître la section", async () => {
    permStore.setRoleExclusive("g1", "role-C", false);
    const msg = fakeMessage("g1");
    await helpall(null, msg);
    const body = msg._replies[0].components[0].toJSON().components[2].content;
    assert.ok(!body.includes("Exclusives"), body);
  });

  await cas("un rôle exclusif NOMMÉ (utils/rolePresets.js) a sa PROPRE section, pas noyé dans \"Exclusives\"", async () => {
    permStore.setRoleExclusive("g2", "role-syndicat", true, "Syndicat");
    const msg = fakeMessage("g2");
    await helpall(null, msg);
    const body = msg._replies[0].components[0].toJSON().components[2].content;
    assert.ok(body.includes("Syndicat") && body.includes("(hors hiérarchie)"), body);
    assert.ok(!body.includes("**Exclusives**"), "un rôle nommé ne doit pas atterrir dans le bloc générique");
  });

  await cas("un exclusif nommé et un exclusif sans nom coexistent, chacun dans sa propre section", async () => {
    permStore.setRoleExclusive("g3", "role-syndicat", true, "Syndicat");
    permStore.setRoleExclusive("g3", "role-anonyme", true);
    const msg = fakeMessage("g3");
    await helpall(null, msg);
    const body = msg._replies[0].components[0].toJSON().components[2].content;
    assert.ok(body.includes("Syndicat") && body.includes("<@&role-syndicat>"), body);
    assert.ok(body.includes("**Exclusives**") && body.includes("<@&role-anonyme>"), body);
  });

  await cas("retirer l'exclusivité d'un rôle nommé retire aussi son étiquette", async () => {
    permStore.setRoleExclusive("g4", "role-syndicat", true, "Syndicat");
    assert.strictEqual(permStore.getExclusiveLabel("g4", "role-syndicat"), "Syndicat");
    permStore.setRoleExclusive("g4", "role-syndicat", false);
    assert.strictEqual(permStore.getExclusiveLabel("g4", "role-syndicat"), null);
  });

  console.log("\nLimite Discord (4000 caractères par TextDisplayComponent) :");

  await cas("un contenu qui dépasserait 4000 caractères est réparti sur PLUSIEURS composants, pas une erreur Discord", () => {
    // Reproduit ce qui a réellement cassé &perms en conditions réelles : des
    // paliers CUMULATIFS (utils/rolePresets.js) où le plus haut liste toutes
    // les commandes des paliers en dessous — largement de quoi dépasser le
    // plafond Discord une fois les 13 concaténés dans un seul bloc de texte.
    const grosBloc = "x".repeat(2000);
    const tiers = [{ index: 1 }, { index: 2 }, { index: 3 }];
    const result = buildTierCard("guild-vide-pour-ce-test", "Titre", "Intro", tiers, () => grosBloc);
    const textes = result.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content);
    for (const t of textes) assert.ok(t.length <= LIMITE_COMPOSANT, `un composant dépasse la limite (${t.length})`);
    assert.ok(textes.length > 1, "le contenu doit être réparti sur plusieurs composants, pas un seul géant");
    const total = textes.join("\n\n");
    for (const tier of tiers) assert.ok(total.includes(`Permission ${tier.index}`), `palier ${tier.index} manquant après répartition`);
  });

  await cas("un bloc UNIQUE plus gros que la limite est tronqué plutôt que de faire échouer tout le message", () => {
    const enorme = "y".repeat(LIMITE_COMPOSANT + 500);
    const result = buildTierCard("guild-vide-pour-ce-test-2", "Titre", "Intro", [{ index: 1 }], () => enorme);
    const textes = result.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content);
    for (const t of textes) assert.ok(t.length <= LIMITE_COMPOSANT, `un composant dépasse la limite (${t.length})`);
  });

  await cas("&perms/&helpall ne plantent plus avec les VRAIS 13 paliers de utils/rolePresets.js (reproduction exacte de la panne)", async () => {
    const { TIERS, EXCLUSIVE } = require("../utils/rolePresets");
    const guildId = "guild-vrais-paliers";
    TIERS.forEach((tier, i) => permStore.setRoleGrants(guildId, `role-tier-${i}`, tier.keys));
    EXCLUSIVE.forEach((entry, i) => {
      permStore.setRoleGrants(guildId, `role-excl-${i}`, entry.keys);
      permStore.setRoleExclusive(guildId, `role-excl-${i}`, true, entry.label);
    });
    const msgPerms = fakeMessage(guildId);
    const msgHelpall = fakeMessage(guildId);
    await perms(null, msgPerms);
    await helpall(null, msgHelpall);
    assert.strictEqual(msgPerms._replies.length, 1, "&perms doit répondre sans lever d'exception");
    assert.strictEqual(msgHelpall._replies.length, 1, "&helpall doit répondre sans lever d'exception");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
