const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require("discord.js");
const { buildSelect, appendText, actionRow, payload } = require("./panelComponents");
const { registerHandler } = require("./modInteractionRegistry");
const { loadAllCommands } = require("./modCommandLoader");
const { effectiveLevel, isDisabled } = require("./accessControl");
const { canRunCommand } = require("./voiceAccess");
const { LEVEL } = require("./permLevels");

const CATEGORIES = [
  { key: "public", label: "Commandes publiques", levels: [LEVEL.PUBLIC] },
  { key: "configurable", label: "Commandes configurables", levels: [LEVEL.CONFIGURABLE, LEVEL.CONFIGURABLE_NO_COOLDOWN] },
  { key: "sys", label: "Commandes Sys", levels: [LEVEL.SYS, LEVEL.SUPER_SYS] },
];

const PAGE_CHAR_BUDGET = 3500;
const PAGE_COMMAND_CAP = 12;

function allVisibleCommands() {
  return [...new Set(loadAllCommands().values())].filter((c) => !c.hidden);
}

// Filtré sur ce que la personne peut RÉELLEMENT lancer : `&help` sert à
// découvrir ses propres commandes, pas à lister celles qui répondraient
// "permissions insuffisantes" (le routeur reste d'ailleurs silencieux dans
// ce cas, voir utils/modMessageRouter.js). Les commandes publiques
// apparaissent donc toujours, les autres seulement si l'accès est accordé.
function commandsInCategory(categoryKey, member) {
  const category = CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return [];

  return allVisibleCommands()
    .filter((c) => category.levels.includes(effectiveLevel(c)))
    .filter((c) => !isDisabled(c))
    .filter((c) => !member || canRunCommand(c, member))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Les catégories vides sont masquées : inutile de proposer "Commandes Sys"
// à quelqu'un qui n'en a aucune.
function visibleCategories(member) {
  return CATEGORIES.map((category) => ({ category, commands: commandsInCategory(category.key, member) })).filter(
    ({ commands }) => commands.length > 0
  );
}

function renderOverview(prefix, member) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Aide — Modération"));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Voici les commandes que **tu** peux utiliser\n" +
        "Sélectionne une catégorie via le menu ci-dessous pour voir le détail\n" +
        "Les arguments entre [] sont facultatifs, les arguments entre <> sont obligatoires"
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const groups = visibleCategories(member);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      groups.length
        ? groups
            .map(({ category, commands }) => `**${category.label} (${commands.length}) :** ${commands.map((c) => c.name).join(", ")}`)
            .join("\n")
        : "Aucune commande ne t'est accessible pour l'instant."
    )
  );

  if (groups.length) {
    container.addActionRowComponents(
      actionRow(
        buildSelect(
          "modhelp:nav",
          "Naviguer vers une catégorie",
          groups.map(({ category }) => ({ label: category.label, value: category.key }))
        )
      )
    );
  }

  return payload(container);
}

function paginateCommands(commands) {
  const pages = [[]];
  let charCount = 0;

  for (const cmd of commands) {
    const usage = cmd.usage || `&${cmd.name}`;
    const entryLen = cmd.name.length + (cmd.description || "").length + usage.length + 20;
    const currentPage = pages[pages.length - 1];

    if (currentPage.length >= PAGE_COMMAND_CAP || (charCount + entryLen > PAGE_CHAR_BUDGET && currentPage.length > 0)) {
      pages.push([]);
      charCount = 0;
    }

    pages[pages.length - 1].push(cmd);
    charCount += entryLen;
  }

  return pages;
}

function renderCategory(prefix, categoryKey, page = 0, member) {
  const category = CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return renderOverview(prefix, member);

  const commands = commandsInCategory(categoryKey, member);
  const pages = paginateCommands(commands);
  const totalPages = Math.max(1, pages.length);
  const current = pages[page] || [];

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${category.label}`));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Accessibles selon les slots de permission configurés dans &panel\n" +
        "Les arguments entre [] sont facultatifs, les arguments entre <> sont obligatoires" +
        (totalPages > 1 ? `\nPage ${page + 1}/${totalPages}` : "")
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const body = current
    .map((cmd) => {
      const usage = cmd.usage || `${prefix}${cmd.name}`;
      return `**${cmd.name}** (${cmd.description || "Pas de description."})\n└ Usage : \`${usage}\``;
    })
    .join("\n\n");
  appendText(container, body || "Aucune commande dans cette catégorie.");

  const options = visibleCategories(member).map(({ category: c }) => ({ label: c.label, value: c.key }));
  if (page < totalPages - 1) options.push({ label: "Page suivante", value: `next:${categoryKey}:${page}` });
  if (page > 0) options.push({ label: "Page précédente", value: `prev:${categoryKey}:${page}` });

  container.addActionRowComponents(actionRow(buildSelect("modhelp:nav", "Naviguer vers une catégorie", options)));
  return payload(container);
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  if (parts[1] !== "nav") return;

  const value = interaction.values[0];
  const { getPrefixes } = require("./prefixStore");
  const prefix = getPrefixes(interaction.guild.id).musicMod;
  // Filtre selon la personne qui clique, pas celle qui a tapé `&help`.
  const member = interaction.member;

  if (value.startsWith("next:")) {
    const [, categoryKey, page] = value.split(":");
    return interaction.update(renderCategory(prefix, categoryKey, Number(page) + 1, member));
  }
  if (value.startsWith("prev:")) {
    const [, categoryKey, page] = value.split(":");
    return interaction.update(renderCategory(prefix, categoryKey, Number(page) - 1, member));
  }

  return interaction.update(renderCategory(prefix, value, 0, member));
}

registerHandler("modhelp", handle);

module.exports = { CATEGORIES, renderOverview, renderCategory, commandsInCategory };
