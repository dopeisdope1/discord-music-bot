/**
 * Vérifie le centre de modération (module 4 de la refonte du panel) :
 * rechercher un membre affiche une fiche réelle (rôles/sanctions/historique
 * déjà stockés), et chaque bouton de cette fiche ouvre la MÊME carte de
 * formulaire que la commande tapée à la main (utils/commandForms.js),
 * pré-remplie avec ce membre — jamais une deuxième implémentation de
 * warn/timeout/kick/ban. Ce fichier ne re-teste PAS que FORMS.warn_member.run
 * fonctionne (déjà couvert par scripts/test-command-forms.js) : seulement
 * que le panel appelle bien ce mécanisme existant, avec les bons droits.
 *
 * Lancement : node scripts/test-panel-mod-center.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-modcenter-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, buildFicheMembreSpec, handleConfigInteraction, ID } = require("../utils/configPanel");
const historyStore = require("../utils/moderationHistoryStore");
const permStore = require("../utils/permissions/store");

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

const TARGET_ID = "444444444444444444";
let fetchedIds = [];

function makeTargetMember() {
  return {
    id: TARGET_ID,
    user: { tag: "Cible#0001", createdTimestamp: Date.now() - 1000 * 86400 * 400 },
    joinedTimestamp: Date.now() - 1000 * 86400 * 30,
    // `name` et `color` comme un vrai rôle Discord : la fiche est dessinée en
    // image, où `toString()` afficherait le brut "<@&id>" au lieu du nom.
    roles: { cache: new Collection([["role-a", { id: "role-a", name: "RoleA", color: 0x5865f2, toString: () => "@RoleA" }]]) },
    toString: () => `<@${TARGET_ID}>`,
  };
}

function makeGuild() {
  const membersCache = new Collection();
  return {
    id: "gmod",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 5,
    roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
    channels: { cache: new Collection() },
    members: {
      cache: membersCache,
      me: { roles: { highest: { position: 9 } } },
      fetch: async (id) => {
        fetchedIds.push(id);
        if (id !== TARGET_ID) return null;
        const m = makeTargetMember();
        membersCache.set(id, m);
        return m;
      },
    },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "gmod", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

function titre(guild, section, member, state) {
  return buildConfigPanel(guild, section, member, state).components[0].toJSON().components.find((c) => c.type === 10).content;
}

function buttons(guild, section, member, state) {
  const json = buildConfigPanel(guild, section, member, state).components[0].toJSON();
  return json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
}

(async () => {
  console.log("Centre de modération — fiche membre réelle, actions réutilisant les VRAIS handlers :");

  const guild = makeGuild();

  await cas("sans aucun droit de modération, la rubrique n'est pas proposée (retombe sur Accueil)", () => {
    assert.ok(!titre(guild, "modCenter", mkMember("u-none")).includes("Recherche de membre"));
  });

  await cas("avec logs.view seulement, la famille Modération ouvre bien le centre de recherche", async () => {
    permStore.setRoleGrants("gmod", "role-logs", ["logs.view"]);
    const member = mkMember("u-logs", "role-logs");
    let panel = null;
    await handleConfigInteraction({
      customId: `${ID}:nav:moderation`,
      member,
      guild,
      update: async (p) => {
        panel = p;
      },
    });
    const titreVu = panel.components[0].toJSON().components.find((c) => c.type === 10).content;
    assert.ok(titreVu.includes("Recherche de membre"), titreVu);
  });

  await cas("choisir un membre déclenche un fetch CIBLÉ (pas un fetch complet) puis affiche sa fiche", async () => {
    permStore.setRoleGrants("gmod", "role-logs", ["logs.view"]);
    const member = mkMember("u-logs", "role-logs");
    fetchedIds = [];
    let panel = null;
    await handleConfigInteraction({
      customId: `${ID}:modtarget`,
      values: [TARGET_ID],
      member,
      guild,
      update: async (p) => {
        panel = p;
      },
    });
    assert.deepStrictEqual(fetchedIds, [TARGET_ID]);
    // La fiche est désormais une CARTE EN IMAGE : on vérifie qu'elle est bien
    // jointe, puis son contenu réel via la spec dessinée
    // (buildFicheMembreSpec) — un PNG n'est pas inspectable autrement.
    const json = panel.components[0].toJSON();
    assert.ok(json.components.some((c) => c.type === 12), "la fiche doit être affichée en image");
    assert.strictEqual(panel.files[0].name, "fiche-membre.png");
    assert.strictEqual(panel.files[0].attachment.subarray(1, 4).toString(), "PNG");
    assert.deepStrictEqual(panel.attachments, [], "l'édition doit remplacer l'image, pas l'empiler");

    const fiche = buildFicheMembreSpec(guild, guild.members.cache.get(TARGET_ID));
    assert.strictEqual(fiche.membre.sousTitre, TARGET_ID);
    assert.ok(fiche.lignes.find((l) => l.label === "Rôles").valeur.includes("RoleA"), JSON.stringify(fiche.lignes));
    assert.strictEqual(fiche.lignes.find((l) => l.label === "Sanctions").valeur, "0");
    assert.strictEqual(fiche.couleur, "#4ade80", "casier vierge = teinte verte");
  });

  await cas("la teinte de la fiche suit le casier — un membre sanctionné ne se lit pas comme un membre vierge", () => {
    const vierge = buildFicheMembreSpec(guild, guild.members.cache.get(TARGET_ID));
    historyStore.record({ guildId: "gmod", targetId: TARGET_ID, moderatorId: "mod-1", action: "warn", reason: "test teinte" });
    const sanctionne = buildFicheMembreSpec(guild, guild.members.cache.get(TARGET_ID));
    assert.notStrictEqual(sanctionne.couleur, vierge.couleur, "la couleur doit refléter le nombre de sanctions");
    assert.strictEqual(sanctionne.lignes.find((l) => l.label === "Sanctions").valeur, "1");
    assert.ok(sanctionne.lignes.find((l) => l.label === "Dernière").valeur.includes("warn"), "la dernière sanction doit apparaître");
  });

  await cas("avec seulement logs.view, la fiche ne propose QUE \"Historique complet\", aucun bouton punitif", () => {
    const member = mkMember("u-logs", "role-logs");
    const boutons = buttons(guild, "modCenter", member, { modTargetId: TARGET_ID });
    const labels = boutons.map((b) => b.label).filter(Boolean);
    assert.ok(labels.includes("Historique complet"), labels.join(", "));
    assert.ok(!labels.includes("Kick") && !labels.includes("Ban") && !labels.includes("Warn"), labels.join(", "));
  });

  await cas("avec moderation.warn en plus, le bouton Warn apparaît et ouvre la carte pré-remplie avec ce membre", async () => {
    permStore.setRoleGrants("gmod", "role-warn", ["moderation.warn", "logs.view"]);
    const member = mkMember("u-warn", "role-warn");
    const boutons = buttons(guild, "modCenter", member, { modTargetId: TARGET_ID });
    const warnButton = boutons.find((b) => b.label === "Warn");
    assert.ok(warnButton, "le bouton Warn doit apparaître avec moderation.warn");
    assert.strictEqual(warnButton.custom_id, `${ID}:modaction:warn_member:${TARGET_ID}`);

    let replied = null;
    await handleConfigInteraction({
      customId: warnButton.custom_id,
      member,
      guild,
      reply: async (p) => {
        replied = p;
      },
    });
    assert.ok(replied, "la carte de formulaire aurait dû être postée");
    // Le résumé du formulaire est DESSINÉ (carte d'aperçu) : on vérifie que
    // le membre visé y est bien pré-rempli, via les lignes réellement
    // présentées, et que l'aperçu est joint au message.
    const { lignesResume, FORMS, getFormState } = require("../utils/commandForms");
    const resume = lignesResume(FORMS.warn_member, getFormState(member.id, "warn_member") || {}).join("\n");
    assert.ok(resume.includes(`<@${TARGET_ID}>`), resume);
    assert.strictEqual(replied.files?.[0]?.name, "apercu.png", "l'aperçu doit être joint à la carte");
  });

  await cas("sans moderation.ban, actionner directement modaction:ban_member est quand même refusé (pas seulement caché)", async () => {
    const member = mkMember("u-warn", "role-warn"); // a moderation.warn + logs.view, PAS moderation.ban
    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:modaction:ban_member:${TARGET_ID}`,
      member,
      guild,
      reply: async (p) => {
        refused = p;
      },
    });
    assert.ok(refused?.content?.includes("pas la permission"), JSON.stringify(refused));
  });

  await cas("\"Historique complet\" renvoie les VRAIES entrées déjà enregistrées pour ce membre", async () => {
    historyStore.record({ guildId: "gmod", targetId: TARGET_ID, moderatorId: "mod-1", action: "kick", reason: "test" });
    const member = mkMember("u-logs", "role-logs");
    let updated = null;
    let followedUp = null;
    await handleConfigInteraction({
      customId: `${ID}:modhistory:${TARGET_ID}`,
      member,
      guild,
      update: async (p) => {
        updated = p;
      },
      followUp: async (p) => {
        followedUp = p;
        return {};
      },
    });
    assert.ok(updated, "le panel doit rester sur la fiche membre");
    const resultText = followedUp.components[0].toJSON().components.find((c) => c.type === 10).content;
    assert.ok(resultText.includes("`kick`"), resultText);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
