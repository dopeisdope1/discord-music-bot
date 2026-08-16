const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { buildCard, buildSelect, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const addroleConfigStore = require("./addroleConfigStore");

const KEY = "addrole";

// 20 permissions curées (plafonné à 25, limite des
// menus déroulants Discord). Valeurs = noms de clés PermissionFlagsBits.
const PERMISSION_OPTIONS = [
  ["CreateInstantInvite", "Créer une invitation"],
  ["KickMembers", "Expulser des membres"],
  ["BanMembers", "Bannir des membres"],
  ["Administrator", "Administrateur"],
  ["ManageChannels", "Gérer les salons"],
  ["ManageGuild", "Gérer le serveur"],
  ["ManageRoles", "Gérer les rôles"],
  ["ViewAuditLog", "Voir le journal d'audit"],
  ["PrioritySpeaker", "Priorité de parole"],
  ["ManageMessages", "Gérer les messages"],
  ["MentionEveryone", "Mentionner tout le monde"],
  ["MuteMembers", "Rendre muet (vocal)"],
  ["DeafenMembers", "Rendre sourd (vocal)"],
  ["MoveMembers", "Déplacer les membres (vocal)"],
  ["ManageNicknames", "Gérer les pseudos"],
  ["ManageWebhooks", "Gérer les webhooks"],
  ["ManageGuildExpressions", "Gérer les emojis et stickers"],
  ["ManageEvents", "Gérer les événements"],
  ["ManageThreads", "Gérer les fils de discussion"],
  ["ModerateMembers", "Mettre en timeout"],
];

function permissionLabel(key) {
  return PERMISSION_OPTIONS.find(([k]) => k === key)?.[1] || key;
}

function render(guildId) {
  const cfg = addroleConfigStore.getConfig(guildId);

  const container = buildCard({
    title: "Configuration addrole / delrole",
    description: "Sélectionnez les permissions à bloquer (remplace la config actuelle)",
    fields: [
      { name: "Permissions bloquées", value: cfg.blockedPermissions.map(permissionLabel).join(", ") || "aucune" },
      { name: "Rôles par action", value: String(cfg.rolesPerAction) },
    ],
  });

  const blocked = new Set(cfg.blockedPermissions);
  container.addActionRowComponents(
    actionRow(
      buildSelect(
        "modpanel:addrole:permsselect",
        "Choisir les permissions à bloquer",
        PERMISSION_OPTIONS.map(([value, label]) => ({ label, value, default: blocked.has(value) })),
        { min: 0, max: PERMISSION_OPTIONS.length }
      )
    )
  );

  container.addActionRowComponents(
    actionRow(
      buildSelect("modpanel:addrole:actions", "Actions", [
        { label: "Modifier le nombre de rôles par action", value: "rolesperaction" },
        { label: "Réinitialiser les permissions bloquées", value: "reset" },
      ])
    )
  );
  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));

  return payload(container);
}

function rolesPerActionModal(guildId) {
  const cfg = addroleConfigStore.getConfig(guildId);
  const modal = new ModalBuilder().setCustomId("modpanel:addrole:rolesmodal").setTitle("Rôles par action");
  const input = new TextInputBuilder()
    .setCustomId("count")
    .setLabel("Nombre de rôles par action")
    .setStyle(TextInputStyle.Short)
    .setValue(String(cfg.rolesPerAction))
    .setRequired(true)
    .setMaxLength(3);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "permsselect") {
    addroleConfigStore.setBlockedPermissions(guildId, interaction.values);
    return interaction.update(render(guildId));
  }

  if (view === "actions") {
    const value = interaction.values[0];
    if (value === "reset") {
      addroleConfigStore.resetBlockedPermissions(guildId);
      return interaction.update(render(guildId));
    }
    if (value === "rolesperaction") return interaction.showModal(rolesPerActionModal(guildId));
    return;
  }

  if (view === "rolesmodal") {
    const raw = interaction.fields.getTextInputValue("count").trim();
    const count = Number(raw);
    if (Number.isInteger(count) && count > 0) addroleConfigStore.setRolesPerAction(guildId, count);
    return interaction.update(render(guildId));
  }
}

panelRouter.registerPanel({ key: KEY, label: "Config addrole / delrole", render, handle });

module.exports = { render, PERMISSION_OPTIONS };
