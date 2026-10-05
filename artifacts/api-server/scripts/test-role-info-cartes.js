/**
 * Vérifie la refonte de "&role info" (utils/utilityCommands.js::roleInfo) :
 * les commandes débloquées doivent TOUTES rester consultables dans l'image,
 * groupées par préfixe réel, une par ligne — jamais tronquées par "...",
 * jamais toutes sur une seule ligne jointe par des virgules. Le texte
 * alternatif, lui, est plafonné à 1024 caractères par Discord ; la version
 * texte à 4096 (coupe annoncée, jamais une erreur).
 *
 * Lancement : node scripts/test-role-info-cartes.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "role-info-cartes-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { utilityHandlers } = require("../utils/utilityCommands");
const { commandesParPrefixe } = require("../utils/permsCommands");
const { estTableau, enSpec } = require("../utils/sectionDashboard");
const levelStore = require("../utils/permissions/levelStore");
const { keysForLevel } = require("../utils/permissions/levelCatalog");
const permStore = require("./_levelGrants");

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

const ROLE_ID = "111111111111111111";

function makeRole() {
  return {
    id: ROLE_ID,
    name: "Modérateur",
    position: 3,
    hexColor: "#5865f2",
    hoist: true,
    mentionable: false,
    createdTimestamp: Date.now(),
    members: new Collection(),
    toString() {
      return `<@&${this.id}>`;
    },
  };
}

function fakeMessage(guild, role) {
  const message = {
    guild,
    member: { id: "owner-1", guild, roles: { cache: new Collection() } },
    mentions: { roles: new Collection([[role.id, role]]) },
    reply: async (p) => {
      message._reply = p;
    },
  };
  return message;
}

// Beaucoup de permissions -> beaucoup de commandes débloquées, mélangeant
// plusieurs préfixes (gestion + modération), comme un rôle "Modérateur" réel.
const CLES_NOMBREUSES = [
  "moderation.kick", "moderation.ban", "moderation.mute", "moderation.unmute",
  "moderation.timeout", "moderation.untimeout", "moderation.warn", "moderation.clear",
  "moderation.zinkiller", "logs.view", "server.info.view", "server.channels.manage",
  "server.roles.manage", "server.members.list", "server.tools.use",
];

(async () => {
  const role = makeRole();
  const guild = { id: "grolecartes", roles: { cache: new Collection([[role.id, role]]) }, members: { cache: new Collection() } };
  permStore.setRoleGrants(guild.id, role.id, CLES_NOMBREUSES);

  const groupesAttendus = commandesParPrefixe(CLES_NOMBREUSES, guild.id);
  const totalAttendu = groupesAttendus.reduce((n, g) => n + g.commandes.length, 0);

  await cas("un rôle à plus de 20 commandes débloquées produit bien une image (estTableau reste vrai)", async () => {
    const message = fakeMessage(guild, role);
    await utilityHandlers.roleInfo(null, message, []);
    assert.ok(message._reply.files?.length, "la fiche doit être une image, pas un repli texte");
    assert.ok(totalAttendu > 20, "ce test suppose un rôle à plus de 20 commandes — vérifier CLES_NOMBREUSES");
  });

  // Système à NIVEAUX cumulatifs : le rôle reçoit le niveau minimal qui
  // couvre CLES_NOMBREUSES, et ce niveau débloque aussi tout ce qui est en
  // dessous. La fiche doit donc lister les commandes du NIVEAU, pas seulement
  // celles des clés de départ.
  const niveauRole = levelStore.getRoleLevel(guild.id, role.id);
  const groupesNiveau = commandesParPrefixe(keysForLevel(niveauRole), guild.id);
  const attendues = groupesNiveau.flatMap((g) => g.commandes.map((nom) => `${g.prefixe}${nom}`));

  /**
   * Le corps de la fiche, tel que roleInfo le construit : on le récupère par
   * la version texte (salon qui refuse les pièces jointes) — c'est la MÊME
   * chaîne que celle passée au moteur de rendu de l'image.
   */
  async function corpsDeLaFiche() {
    const message = fakeMessage(guild, role);
    message.reply = async (p) => {
      if (p.files) throw new Error("Missing Permissions (Attach Files)");
      message._reply = p;
    };
    await utilityHandlers.roleInfo(null, message, []);
    return message._reply.embeds[0].data.description;
  }

  await cas("l'IMAGE dessine TOUTES les commandes du niveau, sans aucune coupée", async () => {
    const corps = await corpsDeLaFiche();
    const spec = enSpec(corps, { titre: "Informations rôle", guild });
    const items = spec.cartes.flatMap((c) => c.items.map((i) => i.nom));
    const manquantes = attendues.filter((a) => !items.includes(a));
    assert.deepStrictEqual(manquantes, [], "commandes absentes de l'image");
    assert.ok(!items.some((i) => String(i).includes("…")), "aucune ligne coupée par des points de suspension");
    assert.ok(!items.some((i) => /autre\(s\)/.test(String(i))), "plus de message '+N autre(s)'");
  });

  await cas("le texte alternatif respecte la limite Discord (1024) — il résume, l'image fait foi", async () => {
    // Discord refuse une description de pièce jointe au-delà de 1024
    // caractères : un rôle à 100+ commandes ne PEUT pas tout y lister. Ce
    // n'est pas une troncature de la fiche, qui est complète dans l'image.
    const message = fakeMessage(guild, role);
    await utilityHandlers.roleInfo(null, message, []);
    const alt = message._reply.files[0].description || "";
    assert.ok(alt.length <= 1024, `${alt.length} caractères`);
    assert.ok(alt.startsWith("Informations rôle"), alt.slice(0, 80));
  });

  await cas("version texte d'un rôle très peuplé : la réponse part quand même (bornée à 4096), jamais une erreur", async () => {
    const membres = new Collection();
    for (let i = 0; i < 400; i++) membres.set(`m${i}`, { id: `m${i}`, user: { tag: `membre-numero-${i}#0001` } });
    const gros = { ...makeRole(), id: "333333333333333333", name: "Gros", members: membres };
    const guildGros = { id: guild.id, roles: { cache: new Collection([[gros.id, gros]]) }, members: { cache: membres } };
    levelStore.setRoleLevel(guild.id, gros.id, niveauRole);
    const message = fakeMessage(guildGros, gros);
    message.reply = async (p) => {
      if (p.files) throw new Error("Missing Permissions (Attach Files)");
      message._reply = p;
    };
    await utilityHandlers.roleInfo(null, message, []);
    const texte = message._reply?.embeds?.[0]?.data?.description || "";
    assert.ok(texte.length > 0 && texte.length <= 4096, `${texte.length} caractères`);
    assert.ok(texte.includes("liste coupée"), "la coupe doit être annoncée, jamais silencieuse");
  });

  await cas("un rôle sans permission affiche clairement (0), sans planter", async () => {
    const roleVide = { ...makeRole(), id: "222222222222222222", name: "Vide" };
    const guildVide = { id: "grolevide", roles: { cache: new Collection([[roleVide.id, roleVide]]) }, members: { cache: new Collection() } };
    const message = fakeMessage(guildVide, roleVide);
    await utilityHandlers.roleInfo(null, message, []);
    assert.ok(message._reply, "une réponse doit toujours être envoyée");
  });

  await cas("estTableau() reste vrai sur le nouveau format (### + lignes citées)", () => {
    const corps = [
      "### Identité",
      "**ID** : 123",
      "**Couleur** : #000000",
      "",
      "### Commandes débloquées (2) — &",
      "> &role",
      "> &staff",
    ].join("\n");
    assert.ok(estTableau(corps), "le format restructuré doit toujours déclencher le rendu en dashboard");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? ", des échecs sont survenus." : ", tout est vert."}`);
})();
