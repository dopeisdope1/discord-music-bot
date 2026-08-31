const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const { CATEGORIES } = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");

/**
 * Identité d'affichage d'une commande : tous les mots de TÊTE qui sont de
 * vrais mots du déclencheur (pas un argument) — même logique que
 * utils/implementedCommands.js::isImplemented. Sans ça, "role create",
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

function tierOf(cmd) {
  if (cmd.permission === "sys") return "sys";
  if (cmd.permission == null) return "public";
  return "configurable";
}

const TIER_LABELS = { public: "Commandes publiques", configurable: "Commandes configurables", sys: "Commandes Sys" };

/**
 * Réduit une liste d'entrées du catalogue à des IDENTITÉS distinctes, alias
 * collés ("pic/avatar"). `identityOf` (pas le premier mot brut) garantit
 * que des sous-commandes différentes ("role create" / "role delete")
 * restent deux entrées séparées au lieu de se confondre sous "role".
 */
function namesWithAliases(commands) {
  const byIdentity = new Map();
  for (const cmd of commands) {
    const id = identityOf(cmd);
    if (!byIdentity.has(id)) byIdentity.set(id, new Set());
    for (const a of cmd.aliases || []) byIdentity.get(id).add(a);
  }
  return [...byIdentity].map(([id, aliases]) => (aliases.size ? `${id}/${[...aliases].join("/")}` : id));
}

/**
 * &help — UNE seule vue, groupée uniquement par PALIER d'accès
 * (publiques/configurables/Sys), toutes catégories du catalogue confondues.
 * Demande explicite : le découpage par thème (Modération, Logs, Antiraid,
 * Paramètres de modération...) faisait "40 mille pages" à naviguer pour
 * rien — une commande de paramétrage de modération est de toute façon
 * "configurable" comme n'importe quelle autre, pas besoin d'un rayon à
 * part. Les entrées seulement DOCUMENTÉES (sans backend) ne sont plus
 * affichées du tout : ce que la personne voit ici, elle peut réellement
 * l'utiliser, rien d'autre.
 *
 * Filtré sur les droits RÉELS de la personne — même moteur que les
 * commandes et le panel (utils/permissions/engine.js), pas une liste
 * séparée qui pourrait diverger.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 */
function buildHelpPanel(guildId, member) {
  const prefixes = getPrefixes(guildId);
  const canUse = (permission) => can(member, permission);

  const groups = { public: [], configurable: [], sys: [] };
  for (const category of CATEGORIES) {
    for (const cmd of category.commands) {
      if (!isImplemented(cmd) || !canUse(cmd.permission)) continue;
      groups[tierOf(cmd)].push(cmd);
    }
  }

  const placed = new Set();
  const lines = [];
  for (const tier of ["public", "configurable", "sys"]) {
    const names = namesWithAliases(groups[tier]).filter((n) => !placed.has(n));
    if (!names.length) continue;
    for (const n of names) placed.add(n);
    lines.push(`**${TIER_LABELS[tier]} (${names.length}) :** ${names.join(", ")}`);
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Aide"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "Voici les commandes que tu peux utiliser sur ce serveur.",
        "Les arguments entre `[]` sont **facultatifs**, les arguments entre `<>` sont **obligatoires**",
        "",
        ...(lines.length ? lines : ["*Aucune commande accessible.*"]),
        "",
        `Préfixe musique : \`${prefixes.main}\` · préfixe commandes : \`${prefixes.musicMod}\``,
      ].join("\n")
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = { buildHelpPanel, identityOf };
