const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { getCommandConfig, updateCommandConfig, resetCommandConfig } = require("./commandConfigStore");

const WIZARD_TIMEOUT_MS = 180_000;

// Commandes "-" configurables via le panel (tout sauf -help/-panel eux-mêmes).
const CONFIGURABLE_COMMANDS = ["pic", "avatar", "snipe", "clear", "renew", "hide", "unhide", "lock", "unlock"];

const ACTIONS = [
  { value: "allow", label: "Autoriser un rôle" },
  { value: "deny", label: "Interdire un rôle" },
  { value: "channels", label: "Restreindre à des salons" },
  { value: "reset", label: "Réinitialiser cette commande" },
];

function buildCommandSelect(selected) {
  return new StringSelectMenuBuilder()
    .setCustomId("panel_command")
    .setPlaceholder("1. Choisis une commande")
    .addOptions(
      CONFIGURABLE_COMMANDS.map((c) => ({ label: `-${c}`, value: c, default: c === selected }))
    );
}

function buildActionSelect(selected) {
  return new StringSelectMenuBuilder()
    .setCustomId("panel_action")
    .setPlaceholder("2. Choisis une action")
    .addOptions(ACTIONS.map((a) => ({ ...a, default: a.value === selected })));
}

function buildRoleSelect() {
  return new RoleSelectMenuBuilder().setCustomId("panel_role").setPlaceholder("3. Choisis le rôle");
}

function buildChannelSelect() {
  return new ChannelSelectMenuBuilder()
    .setCustomId("panel_channels")
    .setPlaceholder("3. Choisis les salons autorisés (aucun = tous)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(25);
}

function summarize(guildId, command) {
  if (!command) return "Choisis une commande à configurer dans le menu ci-dessous.";
  const cfg = getCommandConfig(guildId, command);
  return [
    `Configuration actuelle de \`-${command}\` :`,
    cfg.allowedRoleIds?.length
      ? `Autorisée en plus pour : ${cfg.allowedRoleIds.map((id) => `<@&${id}>`).join(", ")}`
      : "Aucun rôle supplémentaire autorisé (accès par défaut)",
    cfg.deniedRoleIds?.length
      ? `Interdite pour : ${cfg.deniedRoleIds.map((id) => `<@&${id}>`).join(", ")}`
      : "Interdite pour : personne",
    cfg.allowedChannelIds?.length
      ? `Salons autorisés : ${cfg.allowedChannelIds.map((id) => `<#${id}>`).join(", ")}`
      : "Salons autorisés : tous",
  ].join("\n");
}

function baseRows(state) {
  return [
    new ActionRowBuilder().addComponents(buildCommandSelect(state.command)),
    new ActionRowBuilder().addComponents(buildActionSelect(state.action)),
  ];
}

function renderPayload(guildId, state, extraRow) {
  return {
    embeds: [
      buildStatusEmbed("info", summarize(guildId, state.command), { title: "Panel de configuration" }),
    ],
    components: extraRow ? [...baseRows(state), extraRow] : baseRows(state),
  };
}

/**
 * Ouvre le panel interactif de configuration des permissions par commande
 * (`-panel`, réservé aux administrateurs — la vérification se fait avant
 * l'appel de cette fonction).
 * @param {import('discord.js').Message} message
 */
async function handleCommandPanel(message) {
  const state = { command: null, action: null };
  const panelMessage = await message.reply(renderPayload(message.guildId, state));

  const collector = panelMessage.createMessageComponentCollector({ time: WIZARD_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    if (i.user.id !== message.author.id) {
      await i.reply({
        embeds: [buildStatusEmbed("error", "Seul l'auteur de la commande peut utiliser ce panel.")],
        ephemeral: true,
      });
      return;
    }

    if (i.customId === "panel_command") {
      state.command = i.values[0];
      state.action = null;
      await i.update(renderPayload(message.guildId, state));
      return;
    }

    if (i.customId === "panel_action") {
      state.action = i.values[0];

      if (state.action === "reset") {
        resetCommandConfig(message.guildId, state.command);
        await i.update({
          embeds: [
            buildStatusEmbed("success", `Configuration de \`-${state.command}\` réinitialisée.`, {
              title: "Panel de configuration",
            }),
          ],
          components: [],
        });
        collector.stop();
        return;
      }

      const extraRow = new ActionRowBuilder().addComponents(
        state.action === "channels" ? buildChannelSelect() : buildRoleSelect()
      );
      await i.update(renderPayload(message.guildId, state, extraRow));
      return;
    }

    if (i.customId === "panel_role") {
      const roleId = i.values[0];
      const cfg = getCommandConfig(message.guildId, state.command);
      const field = state.action === "allow" ? "allowedRoleIds" : "deniedRoleIds";
      updateCommandConfig(message.guildId, state.command, {
        [field]: Array.from(new Set([...(cfg[field] || []), roleId])),
      });
      await i.update({
        embeds: [
          buildStatusEmbed("success", summarize(message.guildId, state.command), {
            title: "Panel de configuration",
          }),
        ],
        components: [],
      });
      collector.stop();
      return;
    }

    if (i.customId === "panel_channels") {
      updateCommandConfig(message.guildId, state.command, { allowedChannelIds: i.values });
      await i.update({
        embeds: [
          buildStatusEmbed("success", summarize(message.guildId, state.command), {
            title: "Panel de configuration",
          }),
        ],
        components: [],
      });
      collector.stop();
      return;
    }
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      panelMessage.edit({ components: [] }).catch(() => {});
    }
  });
}

module.exports = { handleCommandPanel, CONFIGURABLE_COMMANDS };
