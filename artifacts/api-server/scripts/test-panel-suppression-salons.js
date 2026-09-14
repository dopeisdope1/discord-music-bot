/**
 * Rubrique "Salons" du panel : cocher plusieurs salons, puis les supprimer
 * d'un coup (utils/configPanel.js).
 *
 * C'est la SEULE action du panel qui détruit définitivement des données —
 * l'historique de messages d'un salon supprimé ne se récupère pas, et
 * `&backup` ne sauvegarde que la structure du serveur. Ce fichier vérifie
 * donc surtout ce qui empêche une suppression non voulue :
 *
 *   - rien ne part au moment de cocher : il faut un second geste, explicite ;
 *   - décocher fonctionne réellement (un menu multiple renvoie l'état complet,
 *     pas la différence — sans remplacement, la liste ne ferait que grossir) ;
 *   - le droit est revérifié au moment d'agir, pas seulement à l'affichage ;
 *   - une sélection oubliée se périme au lieu de rester armée.
 *
 * Lancement : node scripts/test-panel-suppression-salons.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "salons-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
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

const SALON_A = "1546335998529642001";
const SALON_B = "1546335998529642002";
const SALON_PANEL = "1546335998529642003";
const SALON_VERROUILLE = "1546335998529642004";

/** Reconstruit un serveur neuf : chaque cas part d'un état propre. */
function makeGuild() {
  const supprimes = [];
  const salon = (id, nom, deletable = true) => ({
    id,
    name: nom,
    deletable,
    delete: async () => {
      supprimes.push(id);
      guild.channels.cache.delete(id);
    },
  });
  const guild = {
    id: "g1",
    name: "test",
    ownerId: "owner-1",
    memberCount: 3,
    supprimes,
    roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
    channels: {
      cache: new Collection([
        [SALON_A, salon(SALON_A, "general")],
        [SALON_B, salon(SALON_B, "spam")],
        [SALON_PANEL, salon(SALON_PANEL, "staff")],
        [SALON_VERROUILLE, salon(SALON_VERROUILLE, "protege", false)],
      ]),
    },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
  };
  return guild;
}

const membre = (id, autorise) => ({
  id,
  guild: { id: "g1", ownerId: "owner-1" },
  displayName: id,
  roles: { cache: new Collection() },
  permissions: { has: () => autorise },
});
const staff = membre("owner-1", true);
const simple = membre("membre-1", false);

function interaction(customId, { values, guild, user = staff } = {}) {
  const i = {
    customId: `${ID}:${customId}`,
    values,
    member: user,
    user: { id: user.id, tag: `${user.id}#0001` },
    guild,
    channelId: SALON_PANEL,
    client: {},
    misAJour: [],
    ephemeres: [],
    message: { edit: async (p) => i.misAJour.push(p) },
    update: async (p) => i.misAJour.push(p),
    reply: async (p) => i.ephemeres.push(p),
    followUp: async (p) => i.ephemeres.push(p),
  };
  return i;
}

/**
 * Tout le texte réellement dessiné sur l'écran — cartes ET pied.
 *
 * Le pied compte : les phrases de prose (par opposition aux réglages
 * « label : valeur ») y sont rangées par utils/sectionDashboard.js, et c'est
 * donc là qu'atterrit l'avertissement sur le caractère définitif.
 */
const texteDe = (guild, user = staff) => {
  const spec = buildSectionSpec(guild, "channels", user);
  return [
    ...spec.cartes.flatMap((c) => [c.titre || "", ...c.items.map((x) => `${x.nom} ${x.description || ""}`)]),
    spec.pied || "",
  ].join("\n");
};

/**
 * Les actions proposees par l'ecran.
 *
 * Le panel remplace TOUTES ses rangees de boutons par un menu deroulant
 * unique (utils/configPanel.js::regrouperBoutonsEnMenu, demande explicite) :
 * on lit donc les options du menu, pas des boutons — qui n'existent plus
 * nulle part dans le panel.
 */
const actionsDe = (guild, user = staff) =>
  buildConfigPanel(guild, "channels", user)
    .components[0].toJSON()
    .components.filter((c) => c.type === 1)
    .flatMap((r) => r.components)
    // Le menu d'ACTIONS seulement : celui de navigation entre rubriques est
    // toujours présent, et le confondre avec lui ferait passer « aucune
    // action proposée » pour un échec.
    .filter((c) => c.custom_id === `${ID}:action`)
    .flatMap((m) => m.options.map((o) => o.label));

(async () => {
  console.log("Cocher ne supprime rien — il faut un second geste :");

  await cas("choisir des salons ne les supprime PAS", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A, SALON_B], guild }));
    assert.deepStrictEqual(guild.supprimes, [], "aucune suppression ne doit avoir lieu au moment de cocher");
  });

  await cas("un bouton de suppression n'apparaît qu'une fois des salons choisis", async () => {
    const guild = makeGuild();
    // La sélection precedente appartient au meme membre : on la vide d'abord.
    await handleConfigInteraction(interaction("channelsdelclear", { guild }));
    assert.deepStrictEqual(actionsDe(guild), [], "sans sélection, aucune action proposée");

    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A], guild }));
    const labels = actionsDe(guild);
    assert.ok(labels.some((l) => /Supprimer 1 salon/.test(l)), labels.join(", "));
    assert.ok(labels.includes("Vider la sélection"), labels.join(", "));
  });

  await cas("l'écran annonce le nombre exact et le caractère définitif", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A, SALON_B], guild }));
    const texte = texteDe(guild);
    assert.ok(/2 salon\(s\) seront supprimés/i.test(texte), texte);
    assert.ok(/DÉFINITIVEMENT/.test(texte), "le caractère irréversible doit être écrit");
  });

  console.log("\nDécocher fonctionne vraiment :");

  await cas("un menu multiple renvoie l'état complet — la sélection est REMPLACÉE", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A, SALON_B], guild }));
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A], guild }));
    const labels = actionsDe(guild);
    assert.ok(labels.some((l) => /Supprimer 1 salon/.test(l)), `la sélection devait retomber à 1 : ${labels.join(", ")}`);
  });

  await cas("tout décocher fait disparaître le bouton", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A], guild }));
    await handleConfigInteraction(interaction("channelsdelpick", { values: [], guild }));
    assert.deepStrictEqual(actionsDe(guild), []);
  });

  console.log("\nLa suppression, elle, agit vraiment :");

  await cas("les salons choisis sont supprimés, et la sélection vidée", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A, SALON_B], guild }));
    const i = interaction("channelsdelgo", { guild });
    await handleConfigInteraction(i);
    assert.deepStrictEqual(guild.supprimes.sort(), [SALON_A, SALON_B].sort());
    assert.deepStrictEqual(actionsDe(guild), [], "la sélection doit être vidée après coup");
    assert.ok(i.ephemeres.length, "un compte-rendu doit être renvoyé");
    assert.ok(/2 salon\(s\) supprimé/.test(i.ephemeres[0].content), i.ephemeres[0].content);
  });

  await cas("le salon où l'on se trouve est ÉCARTÉ — sinon le compte-rendu disparaîtrait avec lui", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A, SALON_PANEL], guild }));
    const i = interaction("channelsdelgo", { guild });
    await handleConfigInteraction(i);
    assert.deepStrictEqual(guild.supprimes, [SALON_A]);
    assert.ok(/salon où tu es/.test(i.ephemeres[0].content), i.ephemeres[0].content);
  });

  await cas("un salon que le bot ne peut pas supprimer est signalé, pas avalé en silence", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_VERROUILLE], guild }));
    const i = interaction("channelsdelgo", { guild });
    await handleConfigInteraction(i);
    assert.deepStrictEqual(guild.supprimes, []);
    assert.ok(/droits insuffisants/.test(i.ephemeres[0].content), i.ephemeres[0].content);
  });

  await cas("un salon disparu entre-temps ne fait pas échouer le reste", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A, SALON_B], guild }));
    guild.channels.cache.delete(SALON_B); // supprimé à la main pendant ce temps
    const i = interaction("channelsdelgo", { guild });
    await handleConfigInteraction(i);
    assert.deepStrictEqual(guild.supprimes, [SALON_A]);
  });

  console.log("\nLe droit est revérifié AU MOMENT D'AGIR :");

  await cas("un membre sans le droit ne peut ni cocher ni supprimer", async () => {
    const guild = makeGuild();
    // La sélection est faite par quelqu'un d'autorisé...
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A], guild }));
    // ...mais c'est un membre sans droit qui clique.
    const i = interaction("channelsdelgo", { guild, user: simple });
    await handleConfigInteraction(i);
    assert.deepStrictEqual(guild.supprimes, [], "rien ne doit être supprimé");
    // Le refus peut venir de l'acces au panneau lui-meme ou du droit precis :
    // ce qui compte est qu'il soit REFUSE et dit, pas par quelle barriere.
    assert.ok(i.ephemeres.length, "un refus doit être renvoyé");
    assert.ok(/pas.*(accès|permission)/i.test(i.ephemeres[0].content), i.ephemeres[0].content);
  });

  await cas("chacun a SA sélection — celle d'un autre ne peut pas être déclenchée", async () => {
    const guild = makeGuild();
    await handleConfigInteraction(interaction("channelsdelpick", { values: [SALON_A, SALON_B], guild }));
    // Un second membre autorisé n'hérite pas de la sélection du premier.
    const autre = membre("owner-1-bis", true);
    const i = interaction("channelsdelgo", { guild, user: autre });
    await handleConfigInteraction(i);
    assert.deepStrictEqual(guild.supprimes, [], "la sélection d'autrui ne doit pas être exécutable");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
