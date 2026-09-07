/**
 * Vérifie les réglages ajoutés aux Tickets et à la Protection.
 *
 * TICKETS — le système n'avait qu'un rôle staff qui voyait ET fermait tout.
 * Demande explicite : « y'a que ce rôle qui peut close le ticket ou voir le
 * ticket etc des trucs basics ». Sont donc séparés : qui VOIT, qui FERME, la
 * catégorie où créer le salon, et si le demandeur peut fermer le sien.
 *
 * Le point qui compte le plus ici : une configuration DÉJÀ enregistrée doit
 * continuer de se comporter à l'identique. Les nouveaux champs ont donc un
 * défaut qui reproduit l'ancien comportement.
 *
 * PROTECTION — plusieurs seuils existaient dans le code sans aucun moyen de
 * les changer depuis le panel (durée des timeouts, salons exemptés).
 *
 * Lancement : node scripts/test-tickets-securite-reglages.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tickets-secu-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const ticketStore = require("../utils/ticketStore");
const antiSpam = require("../utils/automod/antiSpam");
const antiMention = require("../utils/automod/antiMention");
const antiLink = require("../utils/automod/antiLink");
const { buildConfigPanel, buildSectionSpec, handleConfigInteraction, ID } = require("../utils/configPanel");

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

const STAFF = "1546335998529642628";
const CLOSER = "1546335998529642629";
const CATEGORIE = "1546335998529642630";
const SALON = "1546335998529642631";

const guild = {
  id: "g1",
  name: "test",
  ownerId: "owner-1",
  memberCount: 3,
  roles: {
    cache: new Collection([
      [STAFF, { id: STAFF, name: "Staff" }],
      [CLOSER, { id: CLOSER, name: "Responsables" }],
    ]),
    everyone: { permissions: new PermissionsBitField([]) },
  },
  channels: {
    cache: new Collection([
      [CATEGORIE, { id: CATEGORIE, name: "Support" }],
      [SALON, { id: SALON, name: "flood" }],
    ]),
  },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};
const owner = { id: "owner-1", guild: { id: "g1", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };

const texteDe = (section, state) =>
  buildSectionSpec(guild, section, owner, state)
    .cartes.flatMap((c) => [c.titre || "", ...c.items.map((i) => `${i.nom} ${i.description || ""}`)])
    .join("\n");

/**
 * Tous les libellés proposés par un écran, quel que soit le menu qui les
 * porte : le menu générique d'actions (`cfg:action`, issu des anciens
 * boutons) ou un menu propre à la rubrique, comme celui de Protection.
 */
const actionsDe = (section, state) =>
  buildConfigPanel(guild, section, owner, state)
    .components[0].toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((r) => r.components)
    .filter((c) => Array.isArray(c.options))
    .flatMap((m) => m.options.map((o) => o.label));

const interaction = (customId, values) => ({
  customId: `${ID}:${customId}`,
  values,
  member: owner,
  guild,
  client: {},
  update: async () => ({}),
  reply: async () => ({}),
  followUp: async () => ({}),
});

(async () => {
  console.log("Tickets — qui voit, qui ferme, où :");

  await cas("une configuration existante garde EXACTEMENT son ancien comportement", () => {
    // Seul staffRoleId était enregistré avant : les nouveaux champs doivent
    // valoir ce qui reproduit l'ancien fonctionnement.
    ticketStore.setStaffRole("g1", STAFF);
    const config = ticketStore.getConfig("g1");
    assert.strictEqual(config.staffRoleId, STAFF);
    assert.strictEqual(config.closeRoleId, null, "sans rôle dédié, c'est le staff qui ferme — comme avant");
    assert.strictEqual(config.ownerCanClose, true, "le demandeur pouvait déjà fermer son ticket");
    assert.strictEqual(config.categoryId, null, "les tickets étaient créés à la racine");
  });

  await cas("le rôle qui FERME se règle séparément de celui qui voit", async () => {
    await handleConfigInteraction(interaction("ticketclose", [CLOSER]));
    const config = ticketStore.getConfig("g1");
    assert.strictEqual(config.closeRoleId, CLOSER);
    assert.strictEqual(config.staffRoleId, STAFF, "régler l'un ne doit pas écraser l'autre");
  });

  await cas("la catégorie où créer les tickets se règle depuis le panel", async () => {
    await handleConfigInteraction(interaction("ticketcategory", [CATEGORIE]));
    assert.strictEqual(ticketStore.getConfig("g1").categoryId, CATEGORIE);
  });

  await cas("on peut interdire au demandeur de fermer son propre ticket, puis le rautoriser", async () => {
    await handleConfigInteraction(interaction("ticketownerclose:off", []));
    assert.strictEqual(ticketStore.getConfig("g1").ownerCanClose, false);
    await handleConfigInteraction(interaction("ticketownerclose:on", []));
    assert.strictEqual(ticketStore.getConfig("g1").ownerCanClose, true);
  });

  await cas("l'écran affiche les quatre réglages, avec leur valeur réelle", () => {
    const texte = texteDe("tickets");
    assert.ok(texte.includes("Rôle qui voit les tickets"), texte);
    assert.ok(texte.includes("Rôle qui peut fermer"), texte);
    assert.ok(texte.includes("Le demandeur peut fermer son ticket"), texte);
    assert.ok(texte.includes("Catégorie des tickets"), texte);
  });

  await cas("sans rôle dédié, l'écran dit que c'est le staff qui ferme — pas \"aucun\"", () => {
    ticketStore.setConfig("g1", { closeRoleId: null });
    const texte = texteDe("tickets");
    assert.ok(/le rôle staff/.test(texte), `l'écran doit expliquer le repli : ${texte}`);
  });

  console.log("\nProtection — les seuils sont réglables depuis le panel :");

  await cas("toutes les valeurs configurables sont proposées, y compris celles qui manquaient", () => {
    const labels = actionsDe("protection");
    for (const attendu of [
      "Anti-spam : changer le seuil (messages / secondes)",
      "Anti-spam : durée du timeout",
      "Anti-spam : salons exemptés",
      "Anti-lien : salons où les liens restent autorisés",
      "Anti-mass-mention : durée du timeout",
    ]) {
      assert.ok(labels.includes(attendu), `"${attendu}" manque : ${labels.join(" | ")}`);
    }
  });

  await cas("le seuil de l'anti-spam défile par paliers valides", async () => {
    const avant = antiSpam.getConfig("g1");
    await handleConfigInteraction(interaction("protectionaction", ["spam_threshold"]));
    const apres = antiSpam.getConfig("g1");
    assert.notDeepStrictEqual(
      [apres.maxMessages, apres.windowSeconds],
      [avant.maxMessages, avant.windowSeconds],
      "le seuil doit avoir changé"
    );
    assert.ok(apres.maxMessages >= 2 && apres.maxMessages <= 50, `hors bornes : ${apres.maxMessages}`);
  });

  await cas("les durées de timeout défilent et restent dans les bornes acceptées par Discord", async () => {
    for (const [action, lire] of [
      ["spam_timeout", () => antiSpam.getConfig("g1").timeoutSeconds],
      ["mention_timeout", () => antiMention.getConfig("g1").timeoutSeconds],
    ]) {
      const avant = lire();
      await handleConfigInteraction(interaction("protectionaction", [action]));
      const apres = lire();
      assert.notStrictEqual(apres, avant, `${action} doit changer la durée`);
      // Au-delà de 28 jours, l'API Discord refuse un timeout.
      assert.ok(apres >= 5 && apres <= 28 * 86400, `${action} hors bornes : ${apres}`);
    }
  });

  await cas("choisir des salons exemptés REMPLACE la liste — décocher doit fonctionner", async () => {
    await handleConfigInteraction(interaction("spamexempt", [SALON]));
    assert.deepStrictEqual(antiSpam.getExemptChannels("g1"), [SALON]);
    // Sans remplacement, décocher n'aurait aucun effet : la liste ne ferait
    // que grossir.
    await handleConfigInteraction(interaction("spamexempt", []));
    assert.deepStrictEqual(antiSpam.getExemptChannels("g1"), []);
  });

  await cas("idem pour les salons où les liens restent autorisés", async () => {
    await handleConfigInteraction(interaction("linkallow", [SALON]));
    assert.deepStrictEqual(antiLink.getAllowedChannels("g1"), [SALON]);
    await handleConfigInteraction(interaction("linkallow", []));
    assert.deepStrictEqual(antiLink.getAllowedChannels("g1"), []);
  });

  await cas("un seuil hors bornes est refusé plutôt qu'enregistré", () => {
    assert.strictEqual(antiSpam.setTimeoutSeconds("g1", 0), null);
    assert.strictEqual(antiSpam.setTimeoutSeconds("g1", 99 * 86400), null, "au-delà de 28 jours, Discord refuse");
    assert.strictEqual(antiMention.setTimeoutSeconds("g1", -5), null);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
