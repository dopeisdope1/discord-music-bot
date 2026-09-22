/**
 * Vérifie la refonte de "&role info" (utils/utilityCommands.js::roleInfo) :
 * les commandes débloquées doivent TOUTES rester consultables, groupées par
 * préfixe réel, une par ligne — jamais tronquées par "...", jamais toutes sur
 * une seule ligne jointe par des virgules.
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
const { estTableau } = require("../utils/sectionDashboard");
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

  await cas("aucune commande listée n'est tronquée par des points de suspension", async () => {
    const message = fakeMessage(guild, role);
    await utilityHandlers.roleInfo(null, message, []);
    const alt = message._reply.files[0].description || "";
    assert.ok(!alt.includes("…"), `texte alternatif tronqué : ${alt.slice(0, 200)}`);
    assert.ok(!alt.includes("autre(s)"), "plus de message '+N autre(s)' — toutes les commandes doivent être listées");
  });

  await cas("chaque commande listée porte son vrai préfixe (non-régression du fix précédent)", async () => {
    const message = fakeMessage(guild, role);
    await utilityHandlers.roleInfo(null, message, []);
    const alt = message._reply.files[0].description || "";
    // Au moins une commande de modération réelle avec le préfixe "-", jamais "&".
    assert.ok(alt.includes("-kick") || alt.includes("-ban"), `préfixe modération manquant : ${alt.slice(0, 300)}`);
    assert.ok(!alt.includes("&kick") && !alt.includes("&ban"), "kick/ban ne doivent jamais apparaître sous le préfixe de gestion");
  });

  await cas("toutes les commandes des deux groupes (gestion + modération) sont présentes dans le texte alternatif", async () => {
    const message = fakeMessage(guild, role);
    await utilityHandlers.roleInfo(null, message, []);
    const alt = message._reply.files[0].description || "";
    for (const groupe of groupesAttendus) {
      for (const nom of groupe.commandes) {
        assert.ok(alt.includes(`${groupe.prefixe}${nom}`), `commande manquante dans le texte alternatif : ${groupe.prefixe}${nom}`);
      }
    }
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
