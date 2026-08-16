const { ChannelSelectMenuBuilder, ChannelType } = require("discord.js");
const { buildCard, buildSelect, appendText, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const channelBlacklistStore = require("./channelBlacklistStore");
const { loadAllCommands } = require("./modCommandLoader");
const { LEVEL } = require("./permLevels");
const { chunk } = require("./textHelpers");

const KEY = "blacklist";
const { GLOBAL_SCOPE } = channelBlacklistStore;
const CMD_PAGE_SIZE = 20;
const BACK_OPTION = { label: "Retour", value: "back" };

function scopeLabel(scope) {
  return scope === GLOBAL_SCOPE ? "Toutes commandes (global)" : `Commande : ${scope}`;
}

function configurableCommandNames() {
  return [...loadAllCommands().values()]
    .filter((c) => c.level === LEVEL.CONFIGURABLE || c.level === LEVEL.CONFIGURABLE_NO_COOLDOWN)
    .map((c) => c.name)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();
}

function renderMain(guildId, scope = GLOBAL_SCOPE) {
  const channels = channelBlacklistStore.list(guildId, scope);

  const container = buildCard({
    title: "Blacklist des salons",
    fields: [
      { name: "Portée", value: scopeLabel(scope) },
      { name: "Salons blacklistés", value: String(channels.length) },
    ],
  });

  appendText(container, channels.length ? channels.map((c) => `<#${c}>`).join("\n") : "Aucun salon blacklisté pour cette portée");

  container.addActionRowComponents(
    actionRow(
      buildSelect(`modpanel:blacklist:scope:${scope}`, `Portée : ${scopeLabel(scope)}`, [
        { label: "Toutes commandes (global)", value: "global", default: scope === GLOBAL_SCOPE },
        { label: "Commande spécifique...", value: "pickcommand" },
      ])
    )
  );

  container.addActionRowComponents(
    actionRow(
      buildSelect(`modpanel:blacklist:actions:${scope}`, "Actions", [
        { label: "Ajouter un salon", value: "add" },
        { label: "Retirer un salon", value: "remove" },
      ])
    )
  );
  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));

  return payload(container);
}

function renderCommandScopePicker(guildId, page = 0) {
  const all = configurableCommandNames();
  const pages = chunk(all, CMD_PAGE_SIZE);
  const totalPages = Math.max(1, pages.length);
  const current = pages[page] || [];

  const container = buildCard({ title: "Blacklist des salons — Choisir une commande", description: `Page ${page + 1}/${totalPages}` });

  const options = current.map((c) => ({ label: c, value: `pick:${c}` }));
  if (page < totalPages - 1) options.push({ label: "Page suivante", value: "next" });
  if (page > 0) options.push({ label: "Page précédente", value: "prev" });
  options.push(BACK_OPTION);

  container.addActionRowComponents(actionRow(buildSelect(`modpanel:blacklist:cmdpick:${page}`, "Choisir une commande", options)));
  return payload(container);
}

function renderRemovePicker(guildId, scope) {
  const channels = channelBlacklistStore.list(guildId, scope);
  const container = buildCard({ title: "Retirer un salon blacklisté", description: scopeLabel(scope) });

  const options = channels.map((c) => ({ label: `#${c}`, value: c }));
  options.push(BACK_OPTION);

  container.addActionRowComponents(
    actionRow(buildSelect(`modpanel:blacklist:removepick:${scope}`, channels.length ? "Choisir un salon" : "Aucun salon à retirer", options))
  );
  return payload(container);
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "scope") {
    const value = interaction.values[0];
    if (value === "global") return interaction.update(renderMain(guildId, GLOBAL_SCOPE));
    if (value === "pickcommand") return interaction.update(renderCommandScopePicker(guildId, 0));
    return;
  }

  if (view === "cmdpick") {
    const page = Number(parts[3]);
    const value = interaction.values[0];
    if (value === "back") return interaction.update(renderMain(guildId, GLOBAL_SCOPE));
    if (value === "next") return interaction.update(renderCommandScopePicker(guildId, page + 1));
    if (value === "prev") return interaction.update(renderCommandScopePicker(guildId, page - 1));
    if (value.startsWith("pick:")) return interaction.update(renderMain(guildId, value.slice(5)));
    return;
  }

  if (view === "actions") {
    const scope = parts[3];
    const value = interaction.values[0];

    if (value === "add") {
      const select = new ChannelSelectMenuBuilder()
        .setCustomId(`modpanel:blacklist:addchannel:${scope}`)
        .setPlaceholder("Choisis un salon à blacklister")
        .addChannelTypes(ChannelType.GuildText);
      return interaction.reply({ components: [actionRow(select)], ephemeral: true });
    }

    if (value === "remove") return interaction.update(renderRemovePicker(guildId, scope));
    return;
  }

  if (view === "addchannel") {
    const scope = parts[3];
    const channelId = interaction.values[0];
    channelBlacklistStore.add(guildId, scope, channelId);
    await interaction.update({ content: `<#${channelId}> ajouté à la blacklist (${scopeLabel(scope)}).`, components: [] });
    return;
  }

  if (view === "removepick") {
    const scope = parts[3];
    const value = interaction.values[0];
    if (value === "back") return interaction.update(renderMain(guildId, scope));
    channelBlacklistStore.remove(guildId, scope, value);
    return interaction.update(renderMain(guildId, scope));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Blacklist des salons", render: (guildId) => renderMain(guildId, GLOBAL_SCOPE), handle });

module.exports = { renderMain };
