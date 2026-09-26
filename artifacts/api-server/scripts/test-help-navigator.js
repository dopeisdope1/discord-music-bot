// "&help" navigable — un seul message, jamais plusieurs postés d'affilée,
// même avec 150+ commandes configurables (voir utils/helpNavigator.js).
// Remplace l'ancien &help en texte pur qui spammait jusqu'à 4 messages
// séparés. Un seul préfixe/bucket reste depuis le départ de la modération
// vers son propre bot (moderation-bot) : buildHelpNavigator n'a plus de
// paramètre bucketKey.
process.env.BOT_OWNER_IDS = "OWNER";

const helpNavigator = require("../utils/helpNavigator");

let ok = 0;
function verifie(label, condition) {
  if (!condition) throw new Error(`ÉCHEC — ${label}`);
  ok++;
  console.log(`  ok — ${label}`);
}

const owner = { id: "OWNER", guild: { id: "G1", roles: { cache: new Map() } }, roles: { cache: new Map() } };
const texteDe = (payload) =>
  payload.components[0]
    .toJSON()
    .components.filter((c) => c.content)
    .map((c) => c.content)
    .join("\n");

(async () => {
  console.log("Un seul message, jamais plusieurs :");
  {
    const msg = helpNavigator.buildHelpNavigator("G1", owner);
    verifie("buildHelpNavigator renvoie UN seul payload (pas un tableau de pages)", !Array.isArray(msg) && msg.components.length === 1);
    const total = msg.components[0]
      .toJSON()
      .components.filter((c) => c.content)
      .reduce((n, c) => n + c.content.length, 0);
    verifie("le total de texte reste sous le plafond Discord (4000)", total < 4000);
  }

  console.log("\n&help montre les commandes de gestion accessibles :");
  {
    const msg = helpNavigator.buildHelpNavigator("G1", owner, { tier: "configurable" });
    const texte = texteDe(msg);
    verifie("addrole (gestion) apparaît", texte.includes("addrole"));
  }

  console.log("\nPagination via boutons, jamais un nouveau message :");
  {
    const page0 = helpNavigator.buildHelpNavigator("G1", owner, { tier: "configurable", page: 0 });
    const json0 = page0.components[0].toJSON();
    const boutons = json0.components.find((c) => c.type === 1 && c.components[0]?.type === 2);
    verifie("un palier trop long propose des boutons Précédent/Suivant", Boolean(boutons));
    verifie('"Précédent" est désactivé sur la première page', boutons.components[0].disabled === true);

    const suite = boutons.components[1].custom_id.split(":");
    const page1 = helpNavigator.buildHelpNavigator("G1", owner, { tier: suite[2], page: Number(suite[3]) });
    verifie("la page suivante montre des commandes différentes de la première", texteDe(page0) !== texteDe(page1));
  }

  console.log("\nDécouverte : un membre sans aucun droit ne voit que des paliers vides :");
  {
    const inconnu = { id: "999", guild: { id: "G1", roles: { cache: new Map() } }, roles: { cache: new Map() } };
    const msg = helpNavigator.buildHelpNavigator("G1", inconnu);
    const texte = texteDe(msg);
    verifie("aucune commande configurable n'est promise à un membre non configuré", !texte.includes("`&addrole"));
  }

  console.log("\nInteraction : select et pagination éditent le MÊME message :");
  {
    let miseAJour = null;
    const interactionSelect = {
      customId: "helpnav:select",
      values: ["configurable"],
      guild: { id: "G1" },
      member: owner,
      update: async (payload) => {
        miseAJour = payload;
      },
    };
    await helpNavigator.handleHelpNavInteraction(interactionSelect);
    verifie("le select interaction appelle bien interaction.update (jamais un nouveau message)", miseAJour !== null);
    verifie("le tier choisi est reflété dans le message édité", texteDe(miseAJour).includes("Configurables"));
  }

  console.log(`\n${ok} cas vérifiés, tout est vert.`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
