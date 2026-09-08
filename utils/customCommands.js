const store = require("./customCommandStore");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");

// &addcmd / &delcmd / &listcmd — les réponses toutes faites d'un serveur
// (règles, liens, FAQ), que les modérateurs retapent sinon à la main.
//
// LE RISQUE PRINCIPAL de cette fonctionnalité, et ce qui le contient :
// une réponse enregistrée est du texte libre, republié par le BOT. Un
// `@everyone` dedans deviendrait une mention de masse envoyée avec les
// permissions du bot, déclenchable ensuite par n'importe qui. Toutes les
// réponses partent donc avec `allowedMentions` vide : les mentions
// s'affichent en clair, sans notifier personne.
const SANS_MENTIONS = { parse: [], repliedUser: false };

const PERMISSION = "server.customcommands.manage";

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/**
 * Les mots déjà pris par une vraie commande du bot.
 *
 * Différé plutôt qu'en tête de fichier : utils/musicCommands.js require ce
 * module, un require en tête refermerait la boucle et renverrait un module
 * vide — même piège que celui documenté dans utils/implementedCommands.js.
 */
let reserveesCache = null;
function motsReserves() {
  if (reserveesCache) return reserveesCache;
  try {
    reserveesCache = require("./musicCommands").MOD_COMMAND_NAMES || [];
  } catch (err) {
    // Sans la liste, on REFUSE de valider : accepter un nom sans pouvoir
    // vérifier qu'il n'écrase pas une vraie commande serait le seul défaut
    // vraiment grave de cette fonctionnalité.
    console.error("[customCommands] liste des commandes réelles indisponible :", err.message);
    return null;
  }
  return reserveesCache;
}

async function addcmd(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const nom = args[0];
  const texte = args.slice(1).join(" ");
  if (!nom || !texte) {
    return reply(message, "error", "Utilise : `addcmd <nom> <réponse>`.");
  }

  const reservees = motsReserves();
  if (reservees === null) {
    return reply(message, "error", "Impossible de vérifier les noms réservés pour l'instant — réessaie dans un instant.");
  }

  const resultat = store.set(message.guild.id, nom, texte, message.author.id, reservees);
  if (!resultat.ok) return reply(message, "error", resultat.motif);

  const propre = store.normaliser(nom);
  const { musicMod } = require("./prefixStore").getPrefixes(message.guild.id);
  return reply(
    message,
    "success",
    `${resultat.remplacee ? "Réponse remplacée" : "Commande créée"} : \`${musicMod}${propre}\` (${store.count(message.guild.id)}/${store.MAX_PAR_SERVEUR}).`
  );
}

async function delcmd(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const nom = args[0];
  if (!nom) return reply(message, "error", "Utilise : `delcmd <nom>`.");
  if (!store.remove(message.guild.id, nom)) {
    return reply(message, "error", `Aucune commande personnalisée ne s'appelle \`${store.normaliser(nom)}\`.`);
  }
  return reply(message, "success", `Commande \`${store.normaliser(nom)}\` supprimée.`);
}

async function listcmd(client, message) {
  // Consultable par tout le monde : savoir ce qu'on peut taper n'est pas un
  // pouvoir. Seules la création et la suppression sont gardées.
  const entrees = store.list(message.guild.id);
  const { musicMod } = require("./prefixStore").getPrefixes(message.guild.id);
  if (!entrees.length) {
    return reply(message, "info", `Aucune commande personnalisée. Crée-en une avec \`${musicMod}addcmd <nom> <réponse>\`.`);
  }
  // Les plus utilisées d'abord : sur cinquante entrées, c'est ce qui rend la
  // liste consultable d'un coup d'œil.
  const lignes = [...entrees]
    .sort((a, b) => (b.utilisations || 0) - (a.utilisations || 0) || a.nom.localeCompare(b.nom))
    .map((e) => `\`${musicMod}${e.nom}\` — ${e.utilisations || 0} utilisation(s)`);
  return message.reply({
    embeds: [
      buildStatusEmbed("info", lignes.join("\n"), {
        title: `Commandes personnalisées (${entrees.length}/${store.MAX_PAR_SERVEUR})`,
      }),
    ],
    allowedMentions: SANS_MENTIONS,
  });
}

/**
 * Répond si `mot` est une commande personnalisée de ce serveur.
 *
 * Appelé en DERNIER par le routeur, une fois toutes les vraies commandes
 * écartées : le préfixe `&` est partagé avec un autre bot, et un mot inconnu
 * doit rester sans réponse plutôt que de déclencher quelque chose ici.
 *
 * @returns {Promise<boolean>} true si une réponse a été envoyée
 */
async function repondreSiPersonnalisee(message, mot) {
  const entree = store.get(message.guild.id, mot);
  if (!entree) return false;
  try {
    await message.reply({ content: entree.texte, allowedMentions: SANS_MENTIONS });
    store.noterUtilisation(message.guild.id, mot);
    return true;
  } catch (err) {
    console.error("[customCommands] réponse non envoyée :", err.message);
    return false;
  }
}

module.exports = {
  customCommandHandlers: { addcmd, delcmd, listcmd },
  repondreSiPersonnalisee,
  PERMISSION,
  SANS_MENTIONS,
};
