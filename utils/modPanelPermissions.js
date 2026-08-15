const {
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const { buildCard, buildSelect, appendText, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const permissionsStore = require("./permissionsStore");
const { loadAllCommands } = require("./modCommandLoader");
const { LEVEL } = require("./permLevels");
const { chunk, listField } = require("./textHelpers");

const KEY = "permissions";
const LIST_PAGE_SIZE = 8;
const CMD_PAGE_SIZE = 20;

function configurableCommandNames() {
  return [...loadAllCommands().values()]
    .filter((c) => c.level === LEVEL.CONFIGURABLE || c.level === LEVEL.CONFIGURABLE_NO_COOLDOWN)
    .map((c) => c.name)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort();
}

function renderList(guildId, page = 0) {
  const all = permissionsStore.listByGuild(guildId);
  const pages = chunk(all, LIST_PAGE_SIZE);
  const totalPages = Math.max(1, pages.length);
  const current = pages[page] || [];

  const container = buildCard({
    title: "Permissions",
    description: `Sélectionnez une permission à configurer, ou créez-en une nouvelle\nPage ${page + 1}/${totalPages}`,
  });

  appendText(container, current.length ? current.map((p) => p.name).join("\n") : "Aucune permission configurée.");

  const options = current.map((p) => ({ label: p.name, value: `open:${p.id}` }));
  if (page < totalPages - 1) options.push({ label: "Page suivante", value: "next" });
  if (page > 0) options.push({ label: "Page précédente", value: "prev" });
  options.push({ label: "Créer une permission", value: "create" });

  container.addActionRowComponents(actionRow(buildSelect(`modpanel:permissions:list:${page}`, "Choisir une permission", options)));
  container.addActionRowComponents(...buildNavButtons(panelRouter.RUBRIQUES, KEY));
  return payload(container);
}

function renderDetail(guildId, slotId) {
  const slot = permissionsStore.get(guildId, slotId);
  if (!slot) return renderList(guildId, 0);

  const container = buildCard({
    title: `Permission : ${slot.name}`,
    description:
      `**Type :** ${slot.exclusive ? "Exclusive" : "Hiérarchique"} (position ${slot.position})\n` +
      "Vous pouvez gérer les rôles, commandes et cooldowns de cette permission",
    fields: [
      { name: "Rôles", value: listField(slot.roles.map((r) => `<@&${r}>`), { empty: "aucun" }) },
      { name: "Membres", value: listField(slot.members.map((m) => `<@${m}>`), { empty: "aucun" }) },
      { name: "Commandes", value: listField(slot.commands.map((c) => `\`${c}\``), { empty: "aucune" }) },
      { name: "Cooldown", value: slot.cooldownSeconds != null ? `${slot.cooldownSeconds}s` : "aucun" },
    ],
  });

  const options = [
    { label: "Ajouter un rôle", value: "addrole" },
    { label: "Retirer un rôle", value: "removerole" },
    { label: "Ajouter un membre", value: "addmember" },
    { label: "Retirer un membre", value: "removemember" },
    { label: "Ajouter une commande", value: "addcommand" },
    { label: "Retirer une commande", value: "removecommand" },
    { label: "Configurer un cooldown", value: "cooldown" },
    { label: "Retirer un cooldown", value: "removecooldown" },
    { label: "Renommer", value: "rename" },
    { label: "Déplacer", value: "move" },
    { label: "Convertir en exclusive", value: "exclusive" },
    { label: "Supprimer", value: "delete" },
    { label: "Retour", value: "back" },
  ];

  container.addActionRowComponents(actionRow(buildSelect(`modpanel:permissions:detail:${slot.id}`, "Choisir une action", options)));
  return payload(container);
}

function renderCommandPicker(guildId, slotId, mode, page = 0) {
  const slot = permissionsStore.get(guildId, slotId);
  const all = configurableCommandNames();
  const attached = new Set(slot.commands);
  const candidates = mode === "add" ? all.filter((c) => !attached.has(c)) : [...attached];

  const pages = chunk(candidates, CMD_PAGE_SIZE);
  const totalPages = Math.max(1, pages.length);
  const current = pages[page] || [];

  const container = buildCard({
    title: `${mode === "add" ? "Ajouter" : "Retirer"} une commande — ${slot.name}`,
    description: `Page ${page + 1}/${totalPages}`,
  });

  const options = current.map((c) => ({ label: c, value: `pick:${c}` }));
  if (page < totalPages - 1) options.push({ label: "Page suivante", value: "next" });
  if (page > 0) options.push({ label: "Page précédente", value: "prev" });
  options.push({ label: "Retour", value: "back" });

  container.addActionRowComponents(
    actionRow(
      buildSelect(
        `modpanel:permissions:cmdpicker:${slotId}:${mode}:${page}`,
        candidates.length ? "Choisir une commande" : "Aucune commande disponible",
        options.length ? options : [{ label: "Retour", value: "back" }]
      )
    )
  );
  return payload(container);
}

function renameModal(guildId, slotId) {
  const slot = permissionsStore.get(guildId, slotId);
  const modal = new ModalBuilder().setCustomId(`modpanel:permissions:renamemodal:${slotId}`).setTitle("Renommer la permission");
  const input = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Nouveau nom")
    .setStyle(TextInputStyle.Short)
    .setValue(slot.name)
    .setRequired(true)
    .setMaxLength(100);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function cooldownModal(guildId, slotId) {
  const slot = permissionsStore.get(guildId, slotId);
  const modal = new ModalBuilder().setCustomId(`modpanel:permissions:cooldownmodal:${slotId}`).setTitle("Configurer un cooldown");
  const input = new TextInputBuilder()
    .setCustomId("seconds")
    .setLabel("Cooldown en secondes")
    .setStyle(TextInputStyle.Short)
    .setValue(slot.cooldownSeconds != null ? String(slot.cooldownSeconds) : "")
    .setRequired(true)
    .setMaxLength(6);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function renderMoveChoice(guildId, slotId) {
  const slot = permissionsStore.get(guildId, slotId);
  const container = buildCard({ title: `Déplacer — ${slot.name}`, description: "Choisis un sens" });
  container.addActionRowComponents(
    actionRow(
      buildSelect(`modpanel:permissions:movechoice:${slotId}`, "Choisir un sens", [
        { label: "Monter", value: "up" },
        { label: "Descendre", value: "down" },
        { label: "Retour", value: "back" },
      ])
    )
  );
  return payload(container);
}

function renderDeleteConfirm(guildId, slotId) {
  const slot = permissionsStore.get(guildId, slotId);
  const container = buildCard({ title: `Supprimer — ${slot.name}`, description: "Cette action est irréversible." });
  container.addActionRowComponents(
    actionRow(
      buildSelect(`modpanel:permissions:deleteconfirm:${slotId}`, "Confirmer ?", [
        { label: "Confirmer la suppression", value: "confirm" },
        { label: "Annuler", value: "back" },
      ])
    )
  );
  return payload(container);
}

async function handle(interaction) {
  const parts = interaction.customId.split(":");
  const view = parts[2];
  const guildId = interaction.guild.id;

  if (view === "list") {
    const page = Number(parts[3]);
    const value = interaction.values[0];
    if (value === "next") return interaction.update(renderList(guildId, page + 1));
    if (value === "prev") return interaction.update(renderList(guildId, page - 1));
    if (value === "create") {
      const existing = permissionsStore.listByGuild(guildId);
      const slot = permissionsStore.create(guildId, `Permission ${existing.length + 1}`);
      return interaction.update(renderDetail(guildId, slot.id));
    }
    if (value.startsWith("open:")) return interaction.update(renderDetail(guildId, Number(value.slice(5))));
    return;
  }

  if (view === "detail") {
    const slotId = Number(parts[3]);
    const value = interaction.values[0];

    if (value === "back") return interaction.update(renderList(guildId, 0));

    if (value === "addrole" || value === "removerole") {
      const select = new RoleSelectMenuBuilder()
        .setCustomId(`modpanel:permissions:roleselect:${slotId}:${value === "addrole" ? "add" : "remove"}`)
        .setPlaceholder("Choisis un rôle")
        .setMinValues(1)
        .setMaxValues(1);
      return interaction.reply({ components: [actionRow(select)], ephemeral: true });
    }

    if (value === "addmember" || value === "removemember") {
      const select = new UserSelectMenuBuilder()
        .setCustomId(`modpanel:permissions:memberselect:${slotId}:${value === "addmember" ? "add" : "remove"}`)
        .setPlaceholder("Choisis un membre")
        .setMinValues(1)
        .setMaxValues(1);
      return interaction.reply({ components: [actionRow(select)], ephemeral: true });
    }

    if (value === "addcommand") return interaction.update(renderCommandPicker(guildId, slotId, "add", 0));
    if (value === "removecommand") return interaction.update(renderCommandPicker(guildId, slotId, "remove", 0));

    if (value === "cooldown") return interaction.showModal(cooldownModal(guildId, slotId));
    if (value === "removecooldown") {
      permissionsStore.setCooldown(guildId, slotId, null);
      return interaction.update(renderDetail(guildId, slotId));
    }

    if (value === "rename") return interaction.showModal(renameModal(guildId, slotId));
    if (value === "move") return interaction.update(renderMoveChoice(guildId, slotId));

    if (value === "exclusive") {
      const slot = permissionsStore.get(guildId, slotId);
      permissionsStore.setExclusive(guildId, slotId, !slot.exclusive);
      return interaction.update(renderDetail(guildId, slotId));
    }

    if (value === "delete") return interaction.update(renderDeleteConfirm(guildId, slotId));
    return;
  }

  if (view === "cmdpicker") {
    const slotId = Number(parts[3]);
    const mode = parts[4];
    const page = Number(parts[5]);
    const value = interaction.values[0];

    if (value === "back") return interaction.update(renderDetail(guildId, slotId));
    if (value === "next") return interaction.update(renderCommandPicker(guildId, slotId, mode, page + 1));
    if (value === "prev") return interaction.update(renderCommandPicker(guildId, slotId, mode, page - 1));
    if (value.startsWith("pick:")) {
      const commandName = value.slice(5);
      if (mode === "add") permissionsStore.addCommand(guildId, slotId, commandName);
      else permissionsStore.removeCommand(guildId, slotId, commandName);
      return interaction.update(renderDetail(guildId, slotId));
    }
    return;
  }

  if (view === "roleselect") {
    const slotId = Number(parts[3]);
    const mode = parts[4];
    const roleId = interaction.values[0];
    if (mode === "add") permissionsStore.addRole(guildId, slotId, roleId);
    else permissionsStore.removeRole(guildId, slotId, roleId);
    await interaction.update({ content: "✅ Fait.", components: [] });
    return;
  }

  if (view === "memberselect") {
    const slotId = Number(parts[3]);
    const mode = parts[4];
    const userId = interaction.values[0];
    if (mode === "add") permissionsStore.addMember(guildId, slotId, userId);
    else permissionsStore.removeMember(guildId, slotId, userId);
    await interaction.update({ content: "✅ Fait.", components: [] });
    return;
  }

  if (view === "movechoice") {
    const slotId = Number(parts[3]);
    const value = interaction.values[0];
    if (value === "back") return interaction.update(renderDetail(guildId, slotId));
    permissionsStore.move(guildId, slotId, value);
    return interaction.update(renderDetail(guildId, slotId));
  }

  if (view === "deleteconfirm") {
    const slotId = Number(parts[3]);
    const value = interaction.values[0];
    if (value === "back") return interaction.update(renderDetail(guildId, slotId));
    permissionsStore.remove(guildId, slotId);
    return interaction.update(renderList(guildId, 0));
  }

  if (view === "renamemodal") {
    const slotId = Number(parts[3]);
    const name = interaction.fields.getTextInputValue("name").trim();
    if (name) permissionsStore.rename(guildId, slotId, name);
    return interaction.update(renderDetail(guildId, slotId));
  }

  if (view === "cooldownmodal") {
    const slotId = Number(parts[3]);
    const raw = interaction.fields.getTextInputValue("seconds").trim();
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) permissionsStore.setCooldown(guildId, slotId, Math.floor(seconds));
    return interaction.update(renderDetail(guildId, slotId));
  }
}

panelRouter.registerPanel({
  key: KEY,
  label: "Gérer les permissions",
  render: (guildId) => renderList(guildId, 0),
  handle,
});

module.exports = { renderList, renderDetail };
