const { buildStatusEmbed } = require("./statusEmbed");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const { guardHandlers } = require("./guardCommands");
const { automodHandlers } = require("./automodCommands");
const automod = require("./automod/antiSpam");
const serverAdmin = require("./serverAdminCommands");
const securityPanel = require("./securityPanel");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

// "!!" devient l'écosystème SÉCURITÉ complet (architecture 4 préfixes,
// & = gestion / - = modération / !! = sécurité / = = vocal) : chaque mot ci-dessous
// délègue à une fonction déjà écrite et testée sur "&" — aucune nouvelle
// logique de sécurité, juste un second point d'entrée. "&wl"/"&unwl"/
// "&whitelist"/"&antinuke"/"&antilink"/"&antispam" restent
// strictement inchangés sur "&", cette table n'y touche jamais.

/** "!!whitelist" → whitelist ANTI-SPAM (utils/automod/antiSpam.js), même carte que "&whitelist". */
async function whitelistSecurite(client, message) {
  return serverAdmin.whitelist(client, message);
}

/**
 * "!!unwhitelist <@membre>" — retire de la whitelist ANTI-SPAM. Aucune
 * commande texte standalone n'existait pour ça côté "&" (seule la carte de
 * "&whitelist" permet le retrait, via son sélecteur) — même patron que
 * "&unwl" (guardCommands.js) pour la symétrie avec l'ajout.
 */
async function unwhitelistSecurite(client, message, args) {
  if (!can(message.member, "protection.whitelist")) return;
  const membre = message.mentions.users?.first();
  const rawId = args.find((a) => /^\d{15,25}$/.test(a));
  if (!membre && !rawId) return reply(message, "error", "Indique un membre : `unwhitelist @membre`.");

  const id = membre?.id || rawId;
  const retire = automod.removeFromWhitelist(message.guild.id, "users", id);
  return reply(message, retire ? "success" : "info", retire ? `<@${id}> retiré de la whitelist anti-spam.` : `<@${id}> n'y était pas.`);
}

/** "!!security" → alias de "!!secur" (même panneau, mot alternatif). */
async function securityAlias(client, message) {
  if (!securityPanel.estAutorise(message.member)) {
    return message.reply("Tu n'as pas la permission nécessaire pour ouvrir ce panneau.").catch(() => {});
  }
  return message.channel.send(securityPanel.buildSecurityPanel(message.member, client)).catch((err) => {
    console.error("[securityAliases] échec de l'envoi du panneau :", err);
  });
}

// Mot → fonction. "antiraid" est un pur SYNONYME d'"antinuke" : ce bot n'a
// qu'un seul moteur anti-nuke/antiraid (utils/guard/*), jamais deux systèmes
// parallèles pour la même chose.
const ALIASES = {
  wl: guardHandlers.wl,
  unwl: guardHandlers.unwl,
  whitelist: whitelistSecurite,
  unwhitelist: unwhitelistSecurite,
  antinuke: serverAdmin.antinuke,
  antiraid: serverAdmin.antinuke,
  antilink: automodHandlers.antilink,
  antispam: automodHandlers.antispam,
  security: securityAlias,
};

/**
 * Un seul dispatcher pour tous les alias "!!" ci-dessus — même patron que
 * "!!panel"/"!!secur"/etc. (chacun re-vérifie son propre préfixe), mais
 * regroupés ici pour ne pas multiplier les appels indépendants dans
 * index.js à chaque nouveau mot.
 */
async function handleSecurityAliasTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
  const mot = (cmd || "").toLowerCase();

  // Cas spéciaux explicites d'abord (synonymes, alias, whitelist anti-spam vs
  // anti-nuke) — voir ALIASES.
  const alias = ALIASES[mot];
  if (alias) return alias(client, message, args);

  // Sinon, TOUT mot de la catégorie sécurité (utils/commandRouting.js) est
  // servi ici, en déléguant au handler réel (modHandlers). C'est ce qui fait
  // marcher "!!antibot"/"!!badwords"/"!!antichannel"/… après le déplacement
  // dur qui les a retirés de "&". Require paresseux : évite un cycle de
  // chargement avec utils/musicCommands.js.
  const commandRouting = require("./commandRouting");
  if (commandRouting.bucketDe(mot) !== commandRouting.BUCKET_SECURITE) return; // pas un mot sécurité : silence
  const { modHandlers } = require("./musicCommands");
  const handler = modHandlers[mot];
  if (handler) return handler(client, message, args);
}

module.exports = { handleSecurityAliasTextCommand, ALIASES };
