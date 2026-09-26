const { can, hasConfiguredAccess } = require("./permissions/engine");
const { CATEGORIES } = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");
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
 * Le vrai préfixe d'une commande. `prefix: "mod"` = préfixe de gestion (`&`,
 * ou sa valeur configurée) — seul préfixe restant depuis le départ de la
 * modération vers son propre bot (voir utils/prefixStore.js). `null` =
 * déclencheur SANS préfixe (ex. `uo clear`) — lui en coller un annoncerait
 * une commande qui n'existe pas.
 */
function prefixePour(cmd, prefixes) {
  if (!cmd.prefix) return "";
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
 * groupées par PALIER de droit. Les commandes seulement documentées (sans
 * backend) ne sont jamais incluses.
 * @param {import('discord.js').GuildMember} member
 * @returns {Record<"public"|"configurable"|"sys", object[]>}
 */
function groupByPalier(member) {
  const modeDecouverte = !hasConfiguredAccess(member);
  const groups = { public: [], configurable: [], sys: [] };
  for (const category of CATEGORIES) {
    for (const cmd of category.commands) {
      if (!isImplemented(cmd)) continue;
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

module.exports = { identityOf, ACCENT_COLOR, groupByPalier, dedupeByIdentity, formatLine, PALIERS, estDangereux };
