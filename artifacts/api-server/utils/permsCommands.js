const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const levelStore = require("./permissions/levelStore");
const { keysAddedAtLevel, LEVEL_MIN, LEVEL_MAX } = require("./permissions/levelCatalog");
const commandCatalog = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");
const { identityOf } = require("./helpPanel");
const { getPrefixes } = require("./prefixStore");

// &perms / &helpall : vue d'ensemble des 9 niveaux de permission et des
// rôles qui y sont assignés — remplace l'ancien système où le "palier"
// n'était qu'un regroupement d'affichage de rôles ayant EXACTEMENT le même
// ensemble de clés (voir git history pour l'ancienne version, tierSignature/
// computeTiers). Avec les niveaux explicites (utils/permissions/
// levelStore.js), le numéro de palier EST le niveau lui-même, assigné
// directement à un rôle — plus de calcul de signature.

const ALL_COMMANDS = commandCatalog.CATEGORIES.flatMap((c) => c.commands);

/**
 * @returns {{ index: number, keys: string[], roleIds: string[] }[]}
 * Un "tier" par niveau (1-9) qui a AU MOINS un rôle assigné — les niveaux
 * vides n'apparaissent pas. `keys` = les clés du catalogue débloquées À CE
 * NIVEAU PRÉCIS (pas cumulatif ici : afficher "ce que ce niveau ajoute" est
 * plus utile pour un palier numéroté que de répéter tout l'historique
 * cumulé des niveaux en dessous).
 */
function computeTiers(guildId) {
  const byLevel = new Map();
  for (const [roleId, level] of levelStore.listRoleLevels(guildId)) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(roleId);
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, roleIds]) => ({ index: level, keys: keysAddedAtLevel(level), roleIds }));
}

function commandsForKeys(keys) {
  const set = new Set(keys);
  const names = ALL_COMMANDS.filter((cmd) => cmd.permission && set.has(cmd.permission) && isImplemented(cmd)).map(identityOf);
  return [...new Set(names)];
}

/**
 * Le vrai préfixe d'une commande, tapée telle qu'affichée. Un seul préfixe
 * reste sur ce bot depuis le départ de la modération vers son propre bot
 * (voir utils/prefixStore.js) — plus de bucket à distinguer.
 * @param {string} nomCommande identité affichée (identityOf), ex. "kick"
 * @param {ReturnType<typeof getPrefixes>} prefixes
 */
function prefixeDeCommande(nomCommande, prefixes) {
  return prefixes.musicMod;
}

/**
 * Les commandes débloquées par ces clés, PRÉFIXÉES CORRECTEMENT chacune
 * (voir prefixeDeCommande).
 * @returns {string[]} chaque commande déjà entourée de ses backticks
 */
function commandesAffichables(keys, guildId) {
  const prefixes = getPrefixes(guildId);
  return commandsForKeys(keys).map((nom) => `\`${prefixeDeCommande(nom, prefixes)}${nom}\``);
}

/**
 * Les commandes débloquées, dans un unique groupe "Gestion" — conservé au
 * format `{label, prefixe, commandes}[]` pour ne pas casser les appelants
 * (&role info, &staff) qui itèrent sur un tableau de groupes, même si un seul
 * groupe subsiste depuis le départ de la modération.
 * @returns {{label: string, prefixe: string, commandes: string[]}[]}
 */
function commandesParPrefixe(keys, guildId) {
  const prefixes = getPrefixes(guildId);
  const commandes = commandsForKeys(keys).sort();
  if (!commandes.length) return [];
  return [{ label: "Gestion", prefixe: prefixes.musicMod, commandes }];
}

/**
 * Certaines clés du catalogue (ex. `panel.roles.manage`) donnent accès à une
 * RUBRIQUE DU PANEL, pas à une commande tapée — elles restent invisibles
 * dans `commandsForKeys`. Sans ça, un niveau qui débloque "1 permission"
 * pouvait afficher "0 commande débloquée : aucune", donnant l'impression
 * trompeuse que rien n'était accordé.
 * @returns {string[]} libellés du catalogue pour les clés sans commande
 */
function nonCommandGrants(keys) {
  const commandKeys = new Set(ALL_COMMANDS.filter(isImplemented).map((cmd) => cmd.permission).filter(Boolean));
  return [...new Set(keys.filter((k) => !commandKeys.has(k)))];
}

// Texte brut Discord, comme avant — demande explicite (le rendu en image
// essayé entre-temps ne convenait pas). Discord plafonne le texte affichable
// à 4000 caractères, et ce plafond porte sur le TOTAL du message, pas
// composant par composant : la seule répartition qui tienne est donc PAR
// MESSAGE : plusieurs messages séparés ("1/2", "2/2"...) plutôt qu'un mur de
// texte.
const LIMITE_PAGE = 3800;

/**
 * @returns {string[]} une ou plusieurs pages de texte, chacune sous la limite.
 */
function paginerBlocs(blocs) {
  const pages = [];
  let courante = "";
  for (let bloc of blocs) {
    if (bloc.length > LIMITE_PAGE) bloc = `${bloc.slice(0, LIMITE_PAGE - 1)}…`;
    const candidate = courante ? `${courante}\n\n${bloc}` : bloc;
    if (candidate.length > LIMITE_PAGE && courante) {
      pages.push(courante);
      courante = bloc;
    } else {
      courante = candidate;
    }
  }
  if (courante) pages.push(courante);
  return pages;
}

/**
 * @returns {object[]} un ou plusieurs payloads de message à envoyer dans
 *   l'ordre (le premier en reply, les suivants en envoi normal — voir perms/
 *   helpall) — jamais un seul message qui dépasserait le plafond Discord.
 */
function buildTierCard(guildId, title, intro, tiers, renderTierLine) {
  const blocs = [];
  for (const tier of tiers) {
    blocs.push(`**Niveau ${tier.index}**\n> ↳ ${renderTierLine(tier) || "*aucune*"}`);
  }

  const pages = paginerBlocs([`> ${intro}`, ...blocs]);
  return pages.map((page, i) => {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}${pages.length > 1 ? ` (${i + 1}/${pages.length})` : ""}`)
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(page.trim()));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  });
}

/** Envoie une ou plusieurs pages : la première en réponse, les suivantes à la suite dans le salon. */
async function envoyerPages(message, pages) {
  await message.reply(pages[0]);
  for (const page of pages.slice(1)) await message.channel.send(page);
}

/** &perms — les commandes débloquées par chaque niveau de permission. */
async function perms(client, message) {
  if (!can(message.member, "panel.permissions.manage")) return;
  const guildId = message.guild.id;
  const tiers = computeTiers(guildId);
  if (!tiers.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucun niveau n'est encore assigné à un rôle (voir `&panel` > Niveaux).", { guildId })] });
  }
  return envoyerPages(
    message,
    buildTierCard(guildId, "Permissions liées aux commandes", "Voici les différents niveaux ainsi que les commandes qu'ils débloquent", tiers, (tier) =>
      commandsForKeys(tier.keys).join(", ")
    )
  );
}

/** &helpall — les rôles associés à chaque niveau de permission. */
async function helpall(client, message) {
  if (!can(message.member, "panel.permissions.manage")) return;
  const guildId = message.guild.id;
  const tiers = computeTiers(guildId);
  if (!tiers.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucun niveau n'est encore assigné à un rôle (voir `&panel` > Niveaux).", { guildId })] });
  }
  return envoyerPages(message, buildTierCard(guildId, "Permissions", "Voici les différents niveaux ainsi que les rôles associés", tiers, (tier) =>
    tier.roleIds.map((id) => `<@&${id}>`).join(", ")
  ));
}

module.exports = {
  perms,
  helpall,
  computeTiers,
  commandsForKeys,
  commandesAffichables,
  commandesParPrefixe,
  prefixeDeCommande,
  nonCommandGrants,
  buildTierCard,
  LIMITE_PAGE,
  LEVEL_MIN,
  LEVEL_MAX,
};
