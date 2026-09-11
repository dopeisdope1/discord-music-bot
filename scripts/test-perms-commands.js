/**
 * Vérifie &perms/&helpall (utils/permsCommands.js) : les rôles ayant
 * EXACTEMENT le même ensemble de permissions accordées sont regroupés sous
 * le même palier numéroté (du plus petit ensemble au plus grand), &perms
 * liste les commandes débloquées par palier, &helpall liste les rôles.
 * Toujours calculé depuis le système existant (utils/permissions/store.js)
 * — aucun nouveau modèle de données, juste une présentation groupée.
 *
 * Rendu en IMAGE (utils/dashboardImage.js), comme &panel : le contenu se
 * vérifie sur la SPEC (utils/permsCommands.js::buildTierSpec), pas dans le
 * texte d'un message Discord — voir scripts/test-panel-role-tiers.js pour
 * le même principe côté panel.
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
const {
  perms,
  helpall,
  computeTiers,
  commandsForKeys,
  buildTierSpec,
  ajouterTexteReparti,
  LIMITE_COMPOSANT,
} = require("../utils/permsCommands");

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

/** roles: { id: "nom affiché" } — juste assez pour que resoudre() résolve les mentions <@&id> sur la spec. */
function fakeGuild(id, roles = {}) {
  const cache = new Collection(Object.entries(roles).map(([roleId, name]) => [roleId, { id: roleId, name }]));
  return { id, roles: { cache } };
}

function fakeMessage(guild) {
  const replies = [];
  return {
    member: { id: "owner-1", guild: { id: guild.id }, roles: { cache: new Collection() } },
    guild,
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

/** Aplati une spec (cartes/items) en un seul texte cherchable, pour des assertions simples. */
const texteDe = (spec) => spec.cartes.flatMap((c) => [c.titre, ...c.items.map((i) => `${i.nom} ${i.description}`)]).join("\n");

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
    const guild = fakeGuild("g1");
    const tiers = computeTiers("g1");
    const spec = buildTierSpec(guild, "Permissions", "intro", tiers, "Commandes débloquées", (t) => commandsForKeys(t.keys).join(", "));
    const texte = texteDe(spec);
    assert.ok(texte.includes("kick"), texte);
    assert.ok(texte.includes("Permission 1") && texte.includes("Permission 2"), texte);
  });

  await cas("&perms répond bien un message (image), pas d'exception", async () => {
    const msg = fakeMessage(fakeGuild("g1"));
    await perms(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(msg._replies[0].files?.[0]?.name === "permissions.png" || msg._replies[0].components, "une carte doit être renvoyée");
  });

  await cas("message informatif si aucune permission accordée sur le serveur", async () => {
    const msg = fakeMessage(fakeGuild("g-vide"));
    await perms(null, msg);
    assert.ok(msg._replies[0].embeds?.[0]?.data?.description?.includes("Aucune permission"));
  });

  console.log("\n&helpall — rôles par palier :");

  await cas("liste bien les DEUX rôles regroupés sous le même palier", () => {
    const guild = fakeGuild("g1", { "role-A": "Alpha", "role-B": "Bravo", "role-C": "Charlie" });
    const tiers = computeTiers("g1");
    const spec = buildTierSpec(guild, "Permissions", "intro", tiers, "Rôles", (t) => t.roleIds.map((id) => `<@&${id}>`).join(", "));
    const texte = texteDe(spec);
    assert.ok(texte.includes("@Alpha") && texte.includes("@Bravo"), texte);
    assert.ok(texte.includes("@Charlie"), texte);
  });

  console.log('\nRôles "exclusifs" (&panel > Permissions) — section à part, sous les paliers :');

  function specHelpall(guild) {
    const tiers = computeTiers(guild.id);
    return buildTierSpec(guild, "Permissions", "intro", tiers, "Rôles", (t) => t.roleIds.map((id) => `<@&${id}>`).join(", "));
  }
  function specPerms(guild) {
    const tiers = computeTiers(guild.id);
    return buildTierSpec(guild, "Permissions liées aux commandes", "intro", tiers, "Commandes débloquées", (t) => commandsForKeys(t.keys).join(", "));
  }

  await cas('un rôle marqué exclusif apparaît dans une carte "Exclusives" sur &perms ET &helpall', () => {
    permStore.setRoleExclusive("g1", "role-C", true);
    const guild = fakeGuild("g1", { "role-C": "Charlie" });

    const texteP = texteDe(specPerms(guild));
    assert.ok(texteP.includes("Exclusives"), texteP);
    assert.ok(texteP.includes("@Charlie"), texteP);

    const texteH = texteDe(specHelpall(guild));
    assert.ok(texteH.includes("Exclusives"), texteH);
    assert.ok(texteH.includes("@Charlie"), texteH);
  });

  await cas('un rôle exclusif n\'apparaît QU\'une fois — plus sous un "Permission N" numéroté', () => {
    // role-C était seul sur son palier ("Permission 2") avant d'être marqué
    // exclusif : signalé — il continuait à s'afficher aux deux endroits.
    const guild = fakeGuild("g1", { "role-C": "Charlie" });
    const spec = specHelpall(guild);
    const exclusiveCard = spec.cartes.find((c) => c.titre === "Exclusives");
    const numberedCards = spec.cartes.filter((c) => c.titre !== "Exclusives");
    assert.ok(exclusiveCard.items[0].description.includes("@Charlie"));
    assert.ok(!numberedCards.some((c) => c.items[0].description.includes("@Charlie")), "role-C ne doit apparaître QUE dans Exclusives");
    assert.strictEqual(numberedCards.length, 1, "le palier qui ne contenait QUE role-C doit disparaître entièrement une fois vide");
  });

  await cas("plusieurs rôles exclusifs sont tous listés", () => {
    permStore.setRoleExclusive("g1", "role-A", true);
    const guild = fakeGuild("g1", { "role-A": "Alpha", "role-C": "Charlie" });
    const texte = texteDe(specHelpall(guild));
    assert.ok(texte.includes("@Alpha") && texte.includes("@Charlie"), texte);
    permStore.setRoleExclusive("g1", "role-A", false);
  });

  await cas("un serveur SANS permission accordée mais avec un rôle exclusif affiche quand même la carte", async () => {
    permStore.setRoleExclusive("g-vide-exclusif", "role-solo", true);
    const guild = fakeGuild("g-vide-exclusif", { "role-solo": "Solo" });
    const msg = fakeMessage(guild);
    await perms(null, msg);
    assert.ok(!msg._replies[0].embeds, 'ce n\'est plus le message "Aucune permission"');
    const texte = texteDe(specPerms(guild));
    assert.ok(texte.includes("Exclusives"));
    assert.ok(texte.includes("@Solo"));
  });

  await cas("retirer l'exclusivité fait disparaître la carte", () => {
    permStore.setRoleExclusive("g1", "role-C", false);
    const guild = fakeGuild("g1");
    const texte = texteDe(specHelpall(guild));
    assert.ok(!texte.includes("Exclusives"), texte);
  });

  await cas('un rôle exclusif NOMMÉ (utils/rolePresets.js) a sa PROPRE carte, pas noyé dans "Exclusives"', () => {
    permStore.setRoleExclusive("g2", "role-syndicat", true, "Syndicat");
    const guild = fakeGuild("g2", { "role-syndicat": "Le Syndicat" });
    const spec = specHelpall(guild);
    assert.ok(spec.cartes.some((c) => c.titre === "Syndicat (hors hiérarchie)"), JSON.stringify(spec.cartes.map((c) => c.titre)));
    assert.ok(!spec.cartes.some((c) => c.titre === "Exclusives"), "un rôle nommé ne doit pas atterrir dans la carte générique");
  });

  await cas("un exclusif nommé et un exclusif sans nom coexistent, chacun dans sa propre carte", () => {
    permStore.setRoleExclusive("g3", "role-syndicat", true, "Syndicat");
    permStore.setRoleExclusive("g3", "role-anonyme", true);
    const guild = fakeGuild("g3", { "role-syndicat": "Le Syndicat", "role-anonyme": "Anonyme" });
    const spec = specHelpall(guild);
    const carteSyndicat = spec.cartes.find((c) => c.titre === "Syndicat (hors hiérarchie)");
    const carteExclusives = spec.cartes.find((c) => c.titre === "Exclusives");
    assert.ok(carteSyndicat.items[0].description.includes("@Le Syndicat"));
    assert.ok(carteExclusives.items[0].description.includes("@Anonyme"));
  });

  await cas("retirer l'exclusivité d'un rôle nommé retire aussi son étiquette", () => {
    permStore.setRoleExclusive("g4", "role-syndicat", true, "Syndicat");
    assert.strictEqual(permStore.getExclusiveLabel("g4", "role-syndicat"), "Syndicat");
    permStore.setRoleExclusive("g4", "role-syndicat", false);
    assert.strictEqual(permStore.getExclusiveLabel("g4", "role-syndicat"), null);
  });

  console.log("\nLimite Discord (4000 caractères de texte affichable au total) :");

  await cas("&perms/&helpall RÉPONDENT (en image) avec les VRAIS 13 paliers cumulatifs de utils/rolePresets.js, sans exception", async () => {
    // Reproduit ce qui a réellement cassé en conditions réelles : DiscordAPIError
    // "Components displayable text size exceeds maximum size of 4000" — un
    // TextDisplayComponent est plafonné à 4000 caractères, ET Discord plafonne
    // aussi le TOTAL affichable du message entier à 4000. Avec des paliers
    // cumulatifs, le plus haut liste à lui seul des dizaines de commandes :
    // largement de quoi dépasser ce plafond une fois les 13 additionnés. Une
    // image (utils/dashboardImage.js) n'a pas cette limite.
    const { TIERS, EXCLUSIVE } = require("../utils/rolePresets");
    const guildId = "guild-vrais-paliers";
    TIERS.forEach((tier, i) => permStore.setRoleGrants(guildId, `role-tier-${i}`, tier.keys));
    EXCLUSIVE.forEach((entry, i) => {
      permStore.setRoleGrants(guildId, `role-excl-${i}`, entry.keys);
      permStore.setRoleExclusive(guildId, `role-excl-${i}`, true, entry.label);
    });
    const guild = fakeGuild(guildId);
    const msgPerms = fakeMessage(guild);
    const msgHelpall = fakeMessage(guild);
    await perms(null, msgPerms);
    await helpall(null, msgHelpall);
    assert.strictEqual(msgPerms._replies.length, 1, "&perms doit répondre sans lever d'exception");
    assert.strictEqual(msgHelpall._replies.length, 1, "&helpall doit répondre sans lever d'exception");
  });

  await cas("repli texte : un contenu qui dépasserait 4000 caractères est réparti sur PLUSIEURS composants", () => {
    const { ContainerBuilder } = require("discord.js");
    const container = new ContainerBuilder();
    const texte = Array.from({ length: 5 }, (_, i) => `Bloc ${i} : ${"x".repeat(1500)}`).join("\n\n");
    ajouterTexteReparti(container, texte);
    const textes = container.toJSON().components.filter((c) => c.type === 10).map((c) => c.content);
    for (const t of textes) assert.ok(t.length <= LIMITE_COMPOSANT, `un composant dépasse la limite (${t.length})`);
    assert.ok(textes.length > 1, "le contenu doit être réparti sur plusieurs composants, pas un seul géant");
    assert.ok(textes.join("\n\n").includes("Bloc 4"), "rien ne doit être perdu en répartissant");
  });

  await cas("repli texte : un bloc UNIQUE plus gros que la limite est tronqué plutôt que de faire échouer tout le message", () => {
    const { ContainerBuilder } = require("discord.js");
    const container = new ContainerBuilder();
    ajouterTexteReparti(container, "y".repeat(LIMITE_COMPOSANT + 500));
    const textes = container.toJSON().components.filter((c) => c.type === 10).map((c) => c.content);
    for (const t of textes) assert.ok(t.length <= LIMITE_COMPOSANT, `un composant dépasse la limite (${t.length})`);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
