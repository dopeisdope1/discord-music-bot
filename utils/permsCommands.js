const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const permStore = require("./permissions/store");
const permCatalog = require("./permissions/catalog");
const commandCatalog = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");
const { identityOf } = require("./helpPanel");

// &perms / &helpall : vue d'ensemble des permissions accordées par rôle,
// dans le même style "Permission 1, 2, 3..." qu'une référence montrée par
// l'utilisateur — MAIS toujours sur le système existant (rôle -> clés du
// catalogue), pas un système de paliers nommés/créables séparé (décision
// déjà prise : garder le système actuel, juste améliorer l'affichage).
//
// Le "palier" ici n'est qu'un regroupement d'AFFICHAGE : tous les rôles qui
// ont EXACTEMENT le même ensemble de clés accordées apparaissent sous le
// même numéro, du plus petit ensemble au plus grand — rien de nouveau à
// gérer, entièrement calculé depuis utils/permissions/store.js.

const ALL_COMMANDS = commandCatalog.CATEGORIES.flatMap((c) => c.commands);

/**
 * @returns {{ index: number, keys: string[], roleIds: string[] }[]}
 *
 * Les rôles marqués "exclusif" (voir &panel > Permissions) n'apparaissent
 * PAS ici — ils sont affichés à part, dans leur propre section "Exclusives"
 * (voir buildTierCard) — pas doublés entre un palier numéroté et cette
 * section.
 */
function computeTiers(guildId) {
  const grants = permStore.listRoleGrants(guildId);
  const exclusiveRoleIds = new Set(permStore.listExclusiveRoles(guildId));
  const bySignature = new Map();
  for (const [roleId, keys] of grants) {
    if (exclusiveRoleIds.has(roleId)) continue;
    const signature = [...keys].sort().join("|");
    if (!bySignature.has(signature)) bySignature.set(signature, { keys: [...keys], roleIds: [] });
    bySignature.get(signature).roleIds.push(roleId);
  }
  return [...bySignature.values()]
    .sort((a, b) => a.keys.length - b.keys.length)
    .map((tier, i) => ({ index: i + 1, ...tier }));
}

function commandsForKeys(keys) {
  const set = new Set(keys);
  const names = ALL_COMMANDS.filter((cmd) => cmd.permission && set.has(cmd.permission) && isImplemented(cmd)).map(identityOf);
  return [...new Set(names)];
}

// Calculés à l'APPEL, pas au chargement du module : `isImplemented` fait un
// require différé vers musicCommands.js (voir implementedCommands.js) pour
// casser un cycle — l'appeler dès le chargement de ce module le rouvrirait,
// puisque musicCommands.js require aussi configPanel.js qui require ce
// fichier-ci.
let CATALOG_LABELS = null;
function catalogLabels() {
  if (!CATALOG_LABELS) CATALOG_LABELS = new Map(permCatalog.byCategory().flatMap((g) => g.permissions).map((p) => [p.key, p.label]));
  return CATALOG_LABELS;
}

/**
 * Certaines clés du catalogue (ex. `panel.roles.manage`) donnent accès à une
 * RUBRIQUE DU PANEL, pas à une commande tapée — elles restent invisibles
 * dans `commandsForKeys`. Sans ça, un rôle avec "1 permission accordée"
 * pouvait afficher "0 commande débloquée : aucune", donnant l'impression
 * trompeuse que rien n'était accordé.
 * @returns {string[]} libellés du catalogue pour les clés sans commande
 */
function nonCommandGrants(keys) {
  const commandKeys = new Set(ALL_COMMANDS.filter(isImplemented).map((cmd) => cmd.permission).filter(Boolean));
  const labels = catalogLabels();
  return [...new Set(keys.filter((k) => !commandKeys.has(k)).map((k) => labels.get(k) || k))];
}

function buildTierCard(guildId, title, intro, tiers, renderTierLine) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const lines = [intro, ""];
  for (const tier of tiers) {
    lines.push(`**Permission ${tier.index}**`);
    lines.push(`> ↳ ${renderTierLine(tier) || "*aucune*"}`);
    lines.push("");
  }
  // Rôles marqués "exclusif" depuis &panel > Permissions (utils/permissions/
  // store.js) : une simple étiquette, affichée à part des paliers numérotés
  // puisqu'elle ne dépend pas des clés accordées. Un rôle avec un NOM propre
  // (ex: "Syndicat", posé par utils/rolePresets.js) a droit à sa propre ligne
  // plutôt que d'être noyé dans un bloc "Exclusives" générique.
  const exclusiveRoleIds = permStore.listExclusiveRoles(guildId);
  if (exclusiveRoleIds.length) {
    const parLabel = new Map();
    const sansLabel = [];
    for (const id of exclusiveRoleIds) {
      const label = permStore.getExclusiveLabel(guildId, id);
      if (label) {
        if (!parLabel.has(label)) parLabel.set(label, []);
        parLabel.get(label).push(id);
      } else {
        sansLabel.push(id);
      }
    }
    for (const [label, ids] of parLabel) {
      lines.push(`**${label}** *(hors hiérarchie)*`);
      lines.push(`> ↳ ${ids.map((id) => `<@&${id}>`).join(", ")}`);
      lines.push("");
    }
    if (sansLabel.length) {
      lines.push("**Exclusives**");
      lines.push(`> ↳ ${sansLabel.map((id) => `<@&${id}>`).join(", ")}`);
    }
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n").trim()));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** &perms — les commandes débloquées par chaque palier de permissions. */
async function perms(client, message) {
  if (!can(message.member, "panel.permissions.manage")) return;
  const guildId = message.guild.id;
  const tiers = computeTiers(guildId);
  const exclusiveRoleIds = permStore.listExclusiveRoles(guildId);
  if (!tiers.length && !exclusiveRoleIds.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucune permission n'est encore accordée à un rôle (voir `&panel` > Permissions).")] });
  }
  return message.reply(
    buildTierCard(
      guildId,
      "Permissions liées aux commandes",
      "Voici les différentes permissions ainsi que les commandes accessibles",
      tiers,
      (tier) => commandsForKeys(tier.keys).join(", ")
    )
  );
}

/** &helpall — les rôles associés à chaque palier de permissions. */
async function helpall(client, message) {
  if (!can(message.member, "panel.permissions.manage")) return;
  const guildId = message.guild.id;
  const tiers = computeTiers(guildId);
  const exclusiveRoleIds = permStore.listExclusiveRoles(guildId);
  if (!tiers.length && !exclusiveRoleIds.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucune permission n'est encore accordée à un rôle (voir `&panel` > Permissions).")] });
  }
  return message.reply(
    buildTierCard(
      guildId,
      "Permissions",
      "Voici les différentes permissions ainsi que les rôles associés",
      tiers,
      (tier) => tier.roleIds.map((id) => `<@&${id}>`).join(", ")
    )
  );
}

module.exports = { perms, helpall, computeTiers, commandsForKeys, nonCommandGrants };
