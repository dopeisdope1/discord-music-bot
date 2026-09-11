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

// Texte brut Discord, comme avant — demande explicite (le rendu en image
// essayé entre-temps ne convenait pas). Discord plafonne le texte affichable
// à 4000 caractères, et ce plafond porte sur le TOTAL du message, pas
// composant par composant : avec des paliers CUMULATIFS (utils/
// rolePresets.js, chaque palier liste toutes les commandes de tous les
// paliers en dessous), le palier le plus haut peut, une fois les 13
// additionnés, largement dépasser ce total — DiscordAPIError constaté en
// conditions réelles. La seule répartition qui tienne est donc PAR MESSAGE :
// plusieurs messages séparés ("1/2", "2/2"...) plutôt qu'un mur de texte.
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
    blocs.push(`**Permission ${tier.index}**\n> ↳ ${renderTierLine(tier) || "*aucune*"}`);
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
    // Même `renderTierLine` que les paliers numérotés (pas une deuxième
    // logique) : sur &perms elle rend des commandes (le texte figé de
    // utils/rolePresets.js en priorité, sinon les vraies débloquées), sur
    // &helpall des mentions de rôle — un rôle exclusif suit la même règle.
    for (const [label, ids] of parLabel) {
      const ligne = renderTierLine({ keys: permStore.getRoleGrants(guildId, ids[0]), roleIds: ids });
      blocs.push(`**◆ ${label}** *(hors hiérarchie)*\n> ↳ ${ligne || "*aucune*"}`);
    }
    if (sansLabel.length) {
      const ligne = renderTierLine({ keys: permStore.getRoleGrants(guildId, sansLabel[0]), roleIds: sansLabel });
      blocs.push(`**Exclusives**\n> ↳ ${ligne || "*aucune*"}`);
    }
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

/** &perms — les commandes débloquées par chaque palier de permissions. */
async function perms(client, message) {
  if (!can(message.member, "panel.permissions.manage")) return;
  const guildId = message.guild.id;
  const tiers = computeTiers(guildId);
  const exclusiveRoleIds = permStore.listExclusiveRoles(guildId);
  if (!tiers.length && !exclusiveRoleIds.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucune permission n'est encore accordée à un rôle (voir `&panel` > Permissions).")] });
  }
  return envoyerPages(
    message,
    buildTierCard(
      guildId,
      "Permissions liées aux commandes",
      "Voici les différentes permissions ainsi que les commandes accessibles",
      tiers,
      // Un texte figé (utils/permissions/store.js::setPermsDisplay, posé par
      // utils/rolePresets.js) prime sur les commandes RÉELLEMENT débloquées —
      // demande explicite de reproduire une référence fournie telle quelle.
      // Tous les rôles d'un même palier partagent le même texte (même
      // ensemble de clés = même origine), un seul suffit à le retrouver.
      (tier) => permStore.getPermsDisplay(guildId, tier.roleIds[0]) || commandsForKeys(tier.keys).join(", ")
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
  return envoyerPages(
    message,
    buildTierCard(
      guildId,
      "Permissions",
      "Voici les différentes permissions ainsi que les rôles associés",
      tiers,
      (tier) => tier.roleIds.map((id) => `<@&${id}>`).join(", ")
    )
  );
}

module.exports = { perms, helpall, computeTiers, commandsForKeys, nonCommandGrants, buildTierCard, LIMITE_PAGE };
