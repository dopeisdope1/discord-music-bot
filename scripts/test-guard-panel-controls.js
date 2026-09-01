/**
 * Vérifie les contrôles ajoutés à &panel > Anti-nuke : whitelist par RÔLE
 * (jusqu'ici seule la whitelist par membre était cliquable, alors que
 * utils/guard/whitelist.js et &antinuke wlrole supportent déjà les rôles),
 * et le rôle pingé / seuil de création de compte réglables depuis le panel
 * plutôt que par commande texte uniquement (utils/configPanel.js).
 *
 * Couvre aussi un bug signalé par l'utilisateur : &panel > Mute (et
 * Tickets, même cause) ne laissait retirer AUCUN rôle une fois choisi — le
 * handler acceptait déjà `interaction.values[0] || null`, mais le
 * RoleSelectMenu n'avait pas `.setMinValues(0)`, donc Discord ne permettait
 * jamais d'envoyer une sélection vide pour l'effacer.
 *
 * Lancement : node scripts/test-guard-panel-controls.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "guardpanel-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, ID } = require("../utils/configPanel");
const guardConfig = require("../utils/guard/config");
const guardWhitelist = require("../utils/guard/whitelist");
const muteStore = require("../utils/muteStore");
const ticketStore = require("../utils/ticketStore");

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

const member = { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
const guild = {
  id: "g1",
  name: "Serveur",
  ownerId: "owner-1",
  roles: { cache: new Collection() },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
};

function baseInteraction(customId, extra = {}) {
  return {
    customId: `${ID}:${customId}`,
    member,
    guild,
    isModalSubmit: () => false,
    reply: async () => {},
    update: async () => {},
    ...extra,
  };
}

(async () => {
  console.log("&panel > Anti-nuke — whitelist par rôle :");

  await cas("guardwlroleadd ajoute le rôle choisi à la whitelist anti-nuke", async () => {
    await handleConfigInteraction(baseInteraction("guardwlroleadd", { values: ["role-a"] }));
    assert.ok(guardWhitelist.getWhitelist("g1").roles.includes("role-a"));
  });

  await cas("guardwlroledel retire le rôle choisi de la whitelist anti-nuke", async () => {
    await handleConfigInteraction(baseInteraction("guardwlroledel", { values: ["role-a"] }));
    assert.ok(!guardWhitelist.getWhitelist("g1").roles.includes("role-a"));
  });

  console.log("\n&panel > Anti-nuke — rôle pingé :");

  await cas("guardping règle le rôle pingé", async () => {
    await handleConfigInteraction(baseInteraction("guardping", { values: ["role-staff"] }));
    assert.strictEqual(guardConfig.getConfig("g1").pingRoleId, "role-staff");
  });

  await cas("guardping avec une sélection vide (min 0) retire le rôle pingé", async () => {
    await handleConfigInteraction(baseInteraction("guardping", { values: [] }));
    assert.strictEqual(guardConfig.getConfig("g1").pingRoleId, null);
  });

  await cas("la rubrique affiche bien le rôle pingé courant", () => {
    guardConfig.setPingRole("g1", "role-staff");
    const json = buildConfigPanel(guild, "guard", member).components[0].toJSON();
    const texte = json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("<@&role-staff>"), texte);
    guardConfig.setPingRole("g1", null);
  });

  console.log("\n&panel > Anti-nuke — seuil de création de compte :");

  await cas("cliquer \"Régler le seuil\" ouvre une modale, ne change rien avant soumission", async () => {
    let modalShown = null;
    await handleConfigInteraction(
      baseInteraction("guardcreationlimit", { showModal: async (m) => { modalShown = m; } })
    );
    assert.ok(modalShown, "une modale doit s'ouvrir");
    assert.strictEqual(guardConfig.getConfig("g1").creationLimitMs, 0);
  });

  await cas("soumettre \"7d\" règle le seuil à 7 jours", async () => {
    await handleConfigInteraction(
      baseInteraction("guardcreationlimit", {
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => "7d" },
      })
    );
    assert.strictEqual(guardConfig.getConfig("g1").creationLimitMs, 7 * 86400000);
  });

  await cas("soumettre \"off\" désactive le seuil", async () => {
    await handleConfigInteraction(
      baseInteraction("guardcreationlimit", {
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => "off" },
      })
    );
    assert.strictEqual(guardConfig.getConfig("g1").creationLimitMs, 0);
  });

  await cas("soumettre une durée invalide explique quoi faire, ne change rien", async () => {
    guardConfig.setCreationLimit("g1", 3 * 86400000);
    const replies = [];
    await handleConfigInteraction(
      baseInteraction("guardcreationlimit", {
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => "n'importe quoi" },
        reply: async (p) => { replies.push(p); },
      })
    );
    assert.strictEqual(guardConfig.getConfig("g1").creationLimitMs, 3 * 86400000, "le seuil précédent doit rester intact");
    assert.ok(replies[0]?.content?.includes("Durée invalide"), JSON.stringify(replies[0]));
  });

  console.log("\n&panel > Mute et Tickets — le rôle choisi doit pouvoir être retiré :");

  await cas("le sélecteur de rôle de mute autorise une sélection vide (min_values: 0)", () => {
    const json = buildConfigPanel(guild, "mute", member).components[0].toJSON();
    const select = json.components.filter((c) => c.type === 1).flatMap((c) => c.components).find((c) => c.custom_id === "cfg:muterole");
    assert.strictEqual(select?.min_values, 0, JSON.stringify(select));
  });

  await cas("choisir puis effacer le rôle de mute le retire vraiment", async () => {
    await handleConfigInteraction(baseInteraction("muterole", { values: ["role-mute"] }));
    assert.strictEqual(muteStore.getMuteRoleId("g1"), "role-mute");
    await handleConfigInteraction(baseInteraction("muterole", { values: [] }));
    assert.strictEqual(muteStore.getMuteRoleId("g1"), null);
  });

  await cas("le sélecteur de rôle staff (tickets) autorise une sélection vide (min_values: 0)", () => {
    const json = buildConfigPanel(guild, "tickets", member).components[0].toJSON();
    const select = json.components.filter((c) => c.type === 1).flatMap((c) => c.components).find((c) => c.custom_id === "cfg:ticketstaff");
    assert.strictEqual(select?.min_values, 0, JSON.stringify(select));
  });

  await cas("choisir puis effacer le rôle staff des tickets le retire vraiment", async () => {
    await handleConfigInteraction(baseInteraction("ticketstaff", { values: ["role-staff"] }));
    assert.strictEqual(ticketStore.getConfig("g1").staffRoleId, "role-staff");
    await handleConfigInteraction(baseInteraction("ticketstaff", { values: [] }));
    assert.strictEqual(ticketStore.getConfig("g1").staffRoleId, null);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
