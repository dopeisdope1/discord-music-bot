const { ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, AttachmentBuilder, MessageFlags } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const permStore = require("./permissions/store");
const permCatalog = require("./permissions/catalog");
const commandCatalog = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");
const { identityOf } = require("./helpPanel");
const { resoudre } = require("./sectionDashboard");
const { rendreEnCache, enTexte } = require("./dashboardImage");

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

// DESSINÉ en image (utils/dashboardImage.js), comme &panel — pas du texte
// Discord brut. Une carte de texte (TextDisplayComponent) est plafonnée à
// 4000 caractères, ET Discord plafonne aussi le total de texte affichable
// sur TOUT le message à 4000 : avec des paliers CUMULATIFS (utils/
// rolePresets.js, chaque palier liste toutes les commandes de tous les
// paliers en dessous), le palier le plus haut peut à lui seul dépasser ce
// plafond une fois les 13 additionnés — DiscordAPIError constaté en
// conditions réelles avec une répartition sur plusieurs composants texte,
// qui ne suffisait pas puisque le plafond porte sur le TOTAL. Une image n'a
// pas cette limite.
const NOM_IMAGE = "permissions.png";
const COULEUR = "#d0d0d0";

// Repli TEXTE si le rendu échoue : un dessin raté ne doit pas rendre la
// commande muette (même principe que &help/&panel/utils/familyHelp.js). Le
// texte de repli peut lui-même dépasser 4000 caractères pour les mêmes
// raisons que ci-dessus — réparti sur plusieurs composants au besoin plutôt
// que de faire échouer jusqu'au repli.
const LIMITE_COMPOSANT = 3800;
function ajouterTexteReparti(container, texte) {
  const blocs = texte.split("\n\n");
  let courant = "";
  for (let bloc of blocs) {
    if (bloc.length > LIMITE_COMPOSANT) bloc = `${bloc.slice(0, LIMITE_COMPOSANT - 1)}…`;
    const candidat = courant ? `${courant}\n\n${bloc}` : bloc;
    if (candidat.length > LIMITE_COMPOSANT && courant) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(courant));
      courant = bloc;
    } else {
      courant = candidat;
    }
  }
  if (courant) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(courant));
}

/**
 * Spec (utils/dashboardImage.js) séparée du rendu, pour rester testable sans
 * dépendre de l'image produite — même principe que utils/configPanel.js::
 * buildSectionSpec.
 * @param {import('discord.js').Guild} guild pour résoudre les mentions de rôle en noms affichables sur l'image
 * @param {string} lineLabel "Rôles" (&helpall) ou "Commandes débloquées" (&perms)
 */
function buildTierSpec(guild, title, intro, tiers, lineLabel, renderTierLine) {
  const cartes = tiers.map((tier) => ({
    titre: `Permission ${tier.index}`,
    couleur: COULEUR,
    items: [{ nom: lineLabel, description: resoudre(renderTierLine(tier) || "*aucune*", guild) }],
  }));

  // Rôles marqués "exclusif" depuis &panel > Permissions (utils/permissions/
  // store.js) : une simple étiquette, affichée à part des paliers numérotés
  // puisqu'elle ne dépend pas des clés accordées. Un rôle avec un NOM propre
  // (ex: "Syndicat", posé par utils/rolePresets.js) a droit à sa propre carte
  // plutôt que d'être noyé dans une carte "Exclusives" générique.
  const exclusiveRoleIds = permStore.listExclusiveRoles(guild.id);
  if (exclusiveRoleIds.length) {
    const parLabel = new Map();
    const sansLabel = [];
    for (const id of exclusiveRoleIds) {
      const label = permStore.getExclusiveLabel(guild.id, id);
      if (label) {
        if (!parLabel.has(label)) parLabel.set(label, []);
        parLabel.get(label).push(id);
      } else {
        sansLabel.push(id);
      }
    }
    for (const [label, ids] of parLabel) {
      cartes.push({
        titre: `${label} (hors hiérarchie)`,
        couleur: COULEUR,
        items: [{ nom: "Rôles", description: resoudre(ids.map((id) => `<@&${id}>`).join(", "), guild) }],
      });
    }
    if (sansLabel.length) {
      cartes.push({
        titre: "Exclusives",
        couleur: COULEUR,
        items: [{ nom: "Rôles", description: resoudre(sansLabel.map((id) => `<@&${id}>`).join(", "), guild) }],
      });
    }
  }

  return { titre: title, sousTitre: intro, cartes, colonnes: 1, hauteursLibres: true };
}

function buildTierCard(guild, title, intro, tiers, lineLabel, renderTierLine) {
  const spec = buildTierSpec(guild, title, intro, tiers, lineLabel, renderTierLine);
  const png = rendreEnCache(spec);
  const container = new ContainerBuilder();
  if (png) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${NOM_IMAGE}`))
    );
  } else {
    ajouterTexteReparti(container, enTexte(spec));
  }
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    ...(png ? { files: [new AttachmentBuilder(png, { name: NOM_IMAGE })] } : {}),
  };
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
      message.guild,
      "Permissions liées aux commandes",
      "Voici les différentes permissions ainsi que les commandes accessibles",
      tiers,
      "Commandes débloquées",
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
      message.guild,
      "Permissions",
      "Voici les différentes permissions ainsi que les rôles associés",
      tiers,
      "Rôles",
      (tier) => tier.roleIds.map((id) => `<@&${id}>`).join(", ")
    )
  );
}

module.exports = {
  perms,
  helpall,
  computeTiers,
  commandsForKeys,
  nonCommandGrants,
  buildTierCard,
  buildTierSpec,
  ajouterTexteReparti,
  LIMITE_COMPOSANT,
};
