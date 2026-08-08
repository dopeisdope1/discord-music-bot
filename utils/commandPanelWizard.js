const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
} = require("discord.js");
const {
  getCommandConfig,
  updateCommandConfig,
  resetCommandConfig,
  getGuildCommandConfigs,
} = require("./commandConfigStore");

const WIZARD_TIMEOUT_MS = 300_000;

// Commandes "-" configurables via le panel (tout sauf -help/-panel eux-mêmes).
const CONFIGURABLE_COMMANDS = ["pic", "avatar", "snipe", "clear", "renew", "hide", "unhide", "lock", "unlock"];

const ACTIONS = [
  { value: "allow", label: "Autoriser un rôle" },
  { value: "deny", label: "Interdire un rôle" },
  { value: "channels", label: "Restreindre à des salons" },
  { value: "reset", label: "Réinitialiser cette commande" },
];

function quote(text) {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function describeConfig(cfg) {
  const parts = [];
  if (cfg.allowedRoleIds?.length) parts.push(`${cfg.allowedRoleIds.length} rôle(s) autorisé(s)`);
  if (cfg.deniedRoleIds?.length) parts.push(`${cfg.deniedRoleIds.length} rôle(s) interdit(s)`);
  if (cfg.allowedChannelIds?.length) parts.push(`${cfg.allowedChannelIds.length} salon(s) autorisé(s)`);
  return parts;
}

function buildOverviewText(guildId) {
  const configs = getGuildCommandConfigs(guildId);
  const lines = CONFIGURABLE_COMMANDS.map((cmd) => {
    const parts = configs[cmd] ? describeConfig(configs[cmd]) : [];
    return `-${cmd} : ${parts.length ? parts.join(", ") : "par défaut"}`;
  });
  return lines.join("\n");
}

function buildDetailText(guildId, command) {
  const cfg = getCommandConfig(guildId, command);
  return [
    cfg.allowedRoleIds?.length
      ? `Autorisée en plus pour : ${cfg.allowedRoleIds.map((id) => `<@&${id}>`).join(", ")}`
      : "Aucun rôle supplémentaire autorisé",
    cfg.deniedRoleIds?.length
      ? `Interdite pour : ${cfg.deniedRoleIds.map((id) => `<@&${id}>`).join(", ")}`
      : "Interdite pour : personne",
    cfg.allowedChannelIds?.length
      ? `Salons autorisés : ${cfg.allowedChannelIds.map((id) => `<#${id}>`).join(", ")}`
      : "Salons autorisés : tous",
  ].join("\n");
}

function buildCommandSelect(selected) {
  return new StringSelectMenuBuilder()
    .setCustomId("panel_command")
    .setPlaceholder("Choisir une commande")
    .addOptions(
      CONFIGURABLE_COMMANDS.map((c) => ({ label: `-${c}`, value: c, default: c === selected }))
    );
}

function buildActionSelect(selected) {
  return new StringSelectMenuBuilder()
    .setCustomId("panel_action")
    .setPlaceholder("Choisir une action")
    .addOptions(ACTIONS.map((a) => ({ ...a, default: a.value === selected })));
}

function buildRoleSelect() {
  return new RoleSelectMenuBuilder().setCustomId("panel_role").setPlaceholder("Choisir le rôle concerné");
}

function buildChannelSelect() {
  return new ChannelSelectMenuBuilder()
    .setCustomId("panel_channels")
    .setPlaceholder("Choisir les salons autorisés (aucun = tous)")
    .setChannelTypes(ChannelType.GuildText)
    .setMinValues(0)
    .setMaxValues(25);
}

/**
 * Construit le panel complet (Components V2) en fonction de l'état courant
 * de la session ({ command, action }).
 */
function renderPanel(guildId, state) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Panel de configuration\n" + quote("Configure l'accès aux commandes `-` : rôles autorisés/interdits, salons.")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Aperçu\n" + quote(buildOverviewText(guildId)))
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      state.command
        ? `## Commande\n${quote(buildDetailText(guildId, state.command))}`
        : "## Commande\n" + quote("Choisis une commande à configurer ci-dessous.")
    )
  );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buildCommandSelect(state.command)));

  if (state.command) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Action\n" + quote(`Que faire avec \`-${state.command}\` ?`))
    );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildActionSelect(state.action)));
  }

  if (state.action === "allow" || state.action === "deny") {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Rôle\n" +
          quote(state.action === "allow" ? "Quel rôle veux-tu autoriser ?" : "Quel rôle veux-tu interdire ?")
      )
    );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildRoleSelect()));
  } else if (state.action === "channels") {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Salons\n" + quote("Choisis les salons autorisés."))
    );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildChannelSelect()));
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Ouvre le panel interactif de configuration des permissions par commande
 * (`-panel`, réservé aux administrateurs — la vérification se fait avant
 * l'appel de cette fonction). Reste ouvert pour enchaîner plusieurs réglages
 * jusqu'au timeout.
 * @param {import('discord.js').Message} message
 */
async function handleCommandPanel(message) {
  const state = { command: null, action: null };
  const panelMessage = await message.reply(renderPanel(message.guildId, state));

  const collector = panelMessage.createMessageComponentCollector({ time: WIZARD_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    if (i.user.id !== message.author.id) {
      await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
      return;
    }

    if (i.customId === "panel_command") {
      state.command = i.values[0];
      state.action = null;
    } else if (i.customId === "panel_action") {
      state.action = i.values[0];
      if (state.action === "reset") {
        resetCommandConfig(message.guildId, state.command);
        state.action = null;
      }
    } else if (i.customId === "panel_role") {
      const cfg = getCommandConfig(message.guildId, state.command);
      const field = state.action === "allow" ? "allowedRoleIds" : "deniedRoleIds";
      updateCommandConfig(message.guildId, state.command, {
        [field]: Array.from(new Set([...(cfg[field] || []), i.values[0]])),
      });
      state.action = null;
    } else if (i.customId === "panel_channels") {
      updateCommandConfig(message.guildId, state.command, { allowedChannelIds: i.values });
      state.action = null;
    }

    await i.update(renderPanel(message.guildId, state));
  });

  collector.on("end", (collected, reason) => {
    if (reason === "time") {
      panelMessage.edit({ components: [] }).catch(() => {});
    }
  });
}

module.exports = { handleCommandPanel, CONFIGURABLE_COMMANDS };
