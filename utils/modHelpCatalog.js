const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require("discord.js");
const { buildSelect, appendText, actionRow, payload } = require("./panelComponents");
const { registerHandler } = require("./modInteractionRegistry");
const { loadAllCommands } = require("./modCommandLoader");
const { effectiveLevel } = require("./accessControl");
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

function commandsInCategory(categoryKey) {
  const category = CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return [];
  return allVisibleCommands()
    .filter((c) => category.levels.includes(effectiveLevel(c)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderOverview(prefix) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Aide — Modération"));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Bienvenue sur le panel d'aide du bot\n" +
        "Sélectionnez une catégorie via le menu ci-dessous pour découvrir vos commandes disponibles\n" +
        "Les arguments entre [] sont facultatifs, les arguments entre <> sont obligatoires"
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const summaryLines = CATEGORIES.map((category) => {
    const commands = commandsInCategory(category.key);
    return `**${category.label} (${commands.length}) :** ${commands.map((c) => c.name).join(", ") || "aucune"}`;
  });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summaryLines.join("\n")));

  container.addActionRowComponents(
    actionRow(buildSelect("modhelp:nav", "Naviguer vers une catégorie", CATEGORIES.map((c) => ({ label: c.label, value: c.key }))))
  );

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

function renderCategory(prefix, categoryKey, page = 0) {
  const category = CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return renderOverview(prefix);

  const commands = commandsInCategory(categoryKey);
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

  const options = CATEGORIES.map((c) => ({ label: c.label, value: c.key }));
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

  if (value.startsWith("next:")) {
    const [, categoryKey, page] = value.split(":");
    return interaction.update(renderCategory(prefix, categoryKey, Number(page) + 1));
  }
  if (value.startsWith("prev:")) {
    const [, categoryKey, page] = value.split(":");
    return interaction.update(renderCategory(prefix, categoryKey, Number(page) - 1));
  }

  return interaction.update(renderCategory(prefix, value, 0));
}

registerHandler("modhelp", handle);

module.exports = { CATEGORIES, renderOverview, renderCategory, commandsInCategory };
