const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { can, hasConfiguredAccess } = require("./permissions/engine");
const { CATEGORIES } = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");
const commandRouting = require("./commandRouting");
const { PERMISSIONS } = require("./permissions/catalog");

// Conservé pour compatibilité (utils/permsCommands.js l'importait) — plus
// aucun composant ne colore quoi que ce soit dans &help.
const ACCENT_COLOR = 0x2c2f5c;

// Catégorie du moteur de permissions (utils/permissions/catalog.js) pour
// chaque clé — sert uniquement à savoir si une commande est "dangereuse"
// pour l'affichage ci-dessous, jamais pour l'octroi réel (utils/
// permissions/engine.js reste l'unique juge de ce qui est accordé).
const CATEGORIE_PAR_CLE = new Map(PERMISSIONS.map((p) => [p.key, p.category]));

// Demande explicite : même accordable par rôle, tout ce qui touche à
// l'ACCÈS/PANEL/PROTECTION/SÉCURITÉ (octroi de permissions, panel,
// anti-nuke/anti-spam...) doit apparaître dans "Sys" plutôt que
// "Configurables", dans les QUATRE aides (&help/-help/!!help/=help) — un
// rôle mal configuré sur ces droits-là est un bien plus gros risque qu'un
// mauvais rôle sur "&kick".
const CATEGORIES_DANGEREUSES = new Set(["panel", "protection"]);
function estDangereux(permission) {
  const cles = Array.isArray(permission) ? permission : [permission];
  return cles.some((cle) => cle === "sys" || CATEGORIES_DANGEREUSES.has(CATEGORIE_PAR_CLE.get(cle)));
}

// Les trois PALIERS de &help, déduits du droit exigé, jamais saisis à la
// main :
//   pas de permission  -> tout le monde
//   "sys" / accès-panel/protection/sécurité -> réservé au rang sys (affichage)
//   toute autre clé    -> accordable par rôle depuis &panel
const PALIERS = [
  { cle: "public", titre: "Publiques" },
  { cle: "configurable", titre: "Configurables" },
  { cle: "sys", titre: "Sys" },
];
function palierDe(cmd) {
  if (!cmd.permission) return "public";
  return estDangereux(cmd.permission) ? "sys" : "configurable";
}

/**
 * Le vrai préfixe d'une commande. Toutes ne vivent pas sur le même :
 * `prefix: "mod"` = préfixe de gestion (`&`, ou sa valeur configurée),
 * `null` = déclencheur SANS préfixe (ex. `uo clear`) — lui en coller un
 * annoncerait une commande qui n'existe pas.
 */
function prefixePour(cmd, prefixes) {
  if (!cmd.prefix) return "";
  const bucket = commandRouting.bucketDe(cmd.name);
  if (bucket === commandRouting.BUCKET_MODERATION) return prefixes.moderation;
  if (bucket === commandRouting.BUCKET_SECURITE) return prefixes.protection;
  return prefixes.musicMod;
}

function descriptionPour(cmd, prefixes) {
  return cmd.description.replace(/&(?=[a-z])/gi, prefixePour(cmd, prefixes));
}

/**
 * Identité d'affichage d'une commande : tous les mots de TÊTE qui sont de
 * vrais mots du déclencheur (pas un argument). Sans ça, "role create",
 * "role delete", "role rename"... fusionnaient tous sous le seul mot
 * ambigu "role".
 * @param {{ name: string, prefix?: string }} cmd
 */
function leadingWords(cmd) {
  if (!cmd.prefix) return [cmd.name];
  const words = cmd.name.trim().split(/\s+/);
  const lead = [];
  for (const w of words) {
    if (/^[a-z]+$/i.test(w)) lead.push(w.toLowerCase());
    else break;
  }
  return lead.length ? lead : [words[0]];
}
const identityOf = (cmd) => leadingWords(cmd).join(" ");

/**
 * Réduit une liste d'entrées du catalogue à des IDENTITÉS distinctes, en
 * gardant la commande représentative (syntaxe + description) et les alias
 * de chacune.
 * @returns {{ cmd: object, aliases: string[] }[]}
 */
function dedupeByIdentity(commands) {
  const byIdentity = new Map();
  for (const cmd of commands) {
    const id = identityOf(cmd);
    if (!byIdentity.has(id)) byIdentity.set(id, { cmd, aliases: new Set() });
    for (const a of cmd.aliases || []) byIdentity.get(id).aliases.add(a);
  }
  return [...byIdentity.values()].map(({ cmd, aliases }) => ({ cmd, aliases: [...aliases] }));
}

/**
 * Toutes les commandes IMPLÉMENTÉES du catalogue auxquelles `member` a accès,
 * groupées par PALIER de droit, pour UN bucket de préfixe donné (voir
 * utils/commandRouting.js). Les commandes seulement documentées (sans
 * backend) ne sont jamais incluses.
 *
 * Généralisé pour servir "&help" (bucket "gestion") ET "-help" (bucket
 * "modération") depuis le même moteur — même principe que !!help/=help, qui
 * ont chacun leur propre liste figée limitée à leur préfixe : un bucket ne
 * doit jamais montrer les commandes d'un autre, même si le catalogue partagé
 * (utils/commandCatalog.js) les référence toutes.
 * @param {import('discord.js').GuildMember} member
 * @param {string} bucket voir utils/commandRouting.js (BUCKET_GESTION, BUCKET_MODERATION, ...)
 * @returns {Record<"public"|"configurable"|"sys", object[]>}
 */
function groupByPalier(member, bucket) {
  const modeDecouverte = !hasConfiguredAccess(member);
  const groups = { public: [], configurable: [], sys: [] };
  for (const category of CATEGORIES) {
    for (const cmd of category.commands) {
      if (!isImplemented(cmd)) continue;
      if (commandRouting.bucketDe(cmd.name) !== bucket) continue;
      // Un membre encore inconnu du moteur ne reçoit pas l'inventaire des
      // commandes publiques : il ne voit que l'aide qu'il vient de demander.
      if (modeDecouverte && identityOf(cmd) !== "help") continue;
      if (!can(member, cmd.permission)) continue;
      groups[palierDe(cmd)].push(cmd);
    }
  }
  return groups;
}

/** Une commande, en ligne : `> \`<préfixe><syntaxe>\` (description · alias : ...)`. */
function formatLine(entry, prefixes) {
  const prefix = prefixePour(entry.cmd, prefixes);
  const description = entry.aliases.length
    ? `${descriptionPour(entry.cmd, prefixes)} · alias : ${entry.aliases.join(", ")}`
    : descriptionPour(entry.cmd, prefixes);
  return `> \`${prefix}${entry.cmd.name}\` (${description})`;
}

// Texte brut Discord : Discord plafonne le texte affichable à 4000
// caractères, et ce plafond porte sur le TOTAL du message, pas composant par
// composant — donc plusieurs messages séparés plutôt qu'un mur de texte quand
// ça déborde (même limite/logique que utils/permsCommands.js::buildTierCard).
const LIMITE_PAGE = 3800;

function paginerBlocs(blocs) {
  const pages = [];
  let courante = "";
  for (const bloc of blocs) {
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
 * Découpe les lignes d'UN palier en plusieurs blocs si besoin, chacun déjà
 * sous LIMITE_PAGE — un palier chargé (ex. "Configurables" pour un membre à
 * qui presque tout est accordé) ne doit jamais être TRONQUÉ, seulement
 * réparti sur plusieurs messages, comme le reste de &help.
 */
function blocsPourPalier(titre, lignes) {
  const groupes = [];
  let courant = [];
  let longueur = titre.length + 10;
  for (const ligne of lignes) {
    const ajout = ligne.length + 1;
    if (courant.length && longueur + ajout > LIMITE_PAGE) {
      groupes.push(courant);
      courant = [];
      longueur = titre.length + 10;
    }
    courant.push(ligne);
    longueur += ajout;
  }
  if (courant.length) groupes.push(courant);
  return groupes.map((lignesDuBloc, i) => `**${titre}${groupes.length > 1 ? ` (${i + 1}/${groupes.length})` : ""}**\n${lignesDuBloc.join("\n")}`);
}

/**
 * &help — "Page d'aide" : chaque palier de droit en section, ses commandes
 * triées par ordre alphabétique en dessous, une ligne par commande
 * (`> \`préfixe+syntaxe\` (description)`). Filtré sur les droits RÉELS de la
 * personne — même moteur que les commandes et le panel
 * (utils/permissions/engine.js), pas une liste séparée qui pourrait diverger.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @returns {object[]} un ou plusieurs payloads de message (Components V2),
 *   à envoyer dans l'ordre — le premier en réponse, les suivants à la suite.
 */
function buildHelpPages(guildId, member) {
  const prefixes = getPrefixes(guildId);
  const groups = groupByPalier(member, commandRouting.BUCKET_GESTION);

  const blocs = [];
  for (const palier of PALIERS) {
    const entries = dedupeByIdentity(groups[palier.cle]).sort((a, b) => identityOf(a.cmd).localeCompare(identityOf(b.cmd)));
    if (!entries.length) continue;
    blocs.push(...blocsPourPalier(palier.titre, entries.map((e) => formatLine(e, prefixes))));
  }

  const intro = "> Permet de voir la liste des commandes en fonction de vos permissions sur le bot";
  const pages = paginerBlocs([intro, ...blocs]);

  return pages.map((page, i) => {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Page d'aide${pages.length > 1 ? ` (${i + 1}/${pages.length})` : ""}`)
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(page.trim()));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  });
}

module.exports = { buildHelpPages, identityOf, ACCENT_COLOR, groupByPalier, dedupeByIdentity, formatLine, PALIERS, estDangereux };
