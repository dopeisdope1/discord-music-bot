const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const permStore = require("./permissions/store");
const commandCatalog = require("./commandCatalog");

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
const shortName = (cmd) => (cmd.prefix ? cmd.name.split(/\s+/)[0] : cmd.name);

/** @returns {{ index: number, keys: string[], roleIds: string[] }[]} */
function computeTiers(guildId) {
  const grants = permStore.listRoleGrants(guildId);
  const bySignature = new Map();
  for (const [roleId, keys] of grants) {
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
  const names = ALL_COMMANDS.filter((cmd) => cmd.permission && set.has(cmd.permission)).map(shortName);
  return [...new Set(names)];
}

function buildTierCard(title, intro, tiers, renderTierLine) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const lines = [intro, ""];
  for (const tier of tiers) {
    lines.push(`**Permission ${tier.index}**`);
    lines.push(`> ↳ ${renderTierLine(tier) || "*aucune*"}`);
    lines.push("");
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n").trim()));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** &perms — les commandes débloquées par chaque palier de permissions. */
async function perms(client, message) {
  if (!can(message.member, "panel.permissions.manage")) return;
  const tiers = computeTiers(message.guild.id);
  if (!tiers.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucune permission n'est encore accordée à un rôle (voir `&panel` > Permissions).")] });
  }
  return message.reply(
    buildTierCard(
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
  const tiers = computeTiers(message.guild.id);
  if (!tiers.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucune permission n'est encore accordée à un rôle (voir `&panel` > Permissions).")] });
  }
  return message.reply(
    buildTierCard(
      "Permissions",
      "Voici les différentes permissions ainsi que les rôles associés",
      tiers,
      (tier) => tier.roleIds.map((id) => `<@&${id}>`).join(", ")
    )
  );
}

module.exports = { perms, helpall, computeTiers };
