const {
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { buildCard, buildSelect, appendText, actionRow, buildNavButtons, payload } = require("./panelComponents");
const panelRouter = require("./modPanelRouter");
const permissionsStore = require("./permissionsStore");
const { loadAllCommands } = require("./modCommandLoader");
const { LEVEL } = require("./permLevels");
const { effectiveLevel } = require("./accessControl");
const commandStateStore = require("./commandStateStore");
const { VOICE_ACTIONS, actionLabel } = require("./voiceAccess");
const { chunk, listField } = require("./textHelpers");

const KEY = "permissions";
const LIST_PAGE_SIZE = 8;
const CMD_PAGE_SIZE = 20;

// Niveaux attribuables à une permission. `owner`/`sys`/`super_sys` en sont
// absents : ils ne passent pas par les slots (voir utils/accessControl.js) et
// les proposer ici ne ferait qu'afficher un réglage sans effet.
//
// On lit `effectiveLevel` et non `command.level` : un niveau posé via
// `&change` doit être pris en compte, sinon une commande passée en
// `configurable` resterait introuvable dans ce sélecteur.
const PICKABLE_LEVELS = [LEVEL.CONFIGURABLE, LEVEL.CONFIGURABLE_NO_COOLDOWN, LEVEL.PUBLIC];

function pickableCommands() {
  const seen = new Set();
  const out = [];
  for (const command of loadAllCommands().values()) {
    if (seen.has(command.name)) continue; // le registre indexe aussi les alias
    seen.add(command.name);
    const level = effectiveLevel(command);
    if (!PICKABLE_LEVELS.includes(level)) continue;
    out.push({ name: command.name, isPublic: level === LEVEL.PUBLIC });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
      {
        name: "Actions vocales",
        value: slot.voiceActions.length ? slot.voiceActions.map(actionLabel).join(", ") : "aucune",
      },
      { name: "Cooldown", value: slot.cooldownSeconds != null ? `${slot.cooldownSeconds}s` : "aucun" },
    ],
  });

  // Les actions vocales se cochent directement ici (multi-sélection), pour
  // pouvoir les régler par slot — y compris sur un slot exclusif.
  container.addActionRowComponents(
    actionRow(
      buildSelect(
        `modpanel:permissions:voiceactions:${slot.id}`,
        "Actions vocales accordées par cette permission",
        VOICE_ACTIONS.map((a) => ({ label: a.label, value: a.key, default: slot.voiceActions.includes(a.key) })),
        { min: 0, max: VOICE_ACTIONS.length }
      )
    )
  );

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
    { label: slot.exclusive ? "Convertir en hiérarchique" : "Convertir en exclusive", value: "exclusive" },
    { label: "Supprimer", value: "delete" },
    { label: "Retour", value: "back" },
  ];

  container.addActionRowComponents(actionRow(buildSelect(`modpanel:permissions:detail:${slot.id}`, "Choisir une action", options)));
  return payload(container);
}

// Sélection MULTIPLE : on coche autant de commandes que voulu d'un coup, au
// lieu de revenir au détail après chacune. La navigation (pages / retour) est
// sortie du menu déroulant vers des boutons, sinon "Page suivante" se
// retrouverait cochable comme une commande.
function renderCommandPicker(guildId, slotId, mode, page = 0, note) {
  const slot = permissionsStore.get(guildId, slotId);
  const all = pickableCommands();
  const attached = new Set(slot.commands);
  // En retrait, on part de ce que le slot contient RÉELLEMENT : une commande
  // supprimée du bot depuis resterait sinon impossible à décrocher.
  const candidates =
    mode === "add"
      ? all.filter((c) => !attached.has(c.name))
      : [...attached].map((name) => all.find((c) => c.name === name) || { name, isPublic: false });

  const pages = chunk(candidates, CMD_PAGE_SIZE);
  const totalPages = Math.max(1, pages.length);
  const current = pages[page] || [];

  const container = buildCard({
    title: `${mode === "add" ? "Ajouter" : "Retirer"} des commandes — ${slot.name}`,
    description:
      (note ? `${note}\n` : "") +
      (candidates.length
        ? `Coche autant de commandes que tu veux, elles seront ${mode === "add" ? "ajoutées" : "retirées"} d'un coup.` +
          (totalPages > 1 ? `\nPage ${page + 1}/${totalPages}` : "")
        : mode === "add"
          ? "Toutes les commandes sont déjà dans cette permission."
          : "Cette permission ne contient aucune commande."),
  });

  if (current.length) {
    container.addActionRowComponents(
      actionRow(
        buildSelect(
          `modpanel:permissions:cmdpicker:${slotId}:${mode}:${page}`,
          `Choisir une ou plusieurs commandes (${current.length} sur cette page)`,
          current.map((c) => ({ label: c.isPublic ? `${c.name} (publique)` : c.name, value: c.name })),
          { min: 0, max: current.length }
        )
      )
    );
  }

  const navButtons = [];
  if (page > 0) {
    navButtons.push(
      new ButtonBuilder()
        .setCustomId(`modpanel:permissions:cmdpage:${slotId}:${mode}:${page - 1}`)
        .setLabel("◀ Page précédente")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (page < totalPages - 1) {
    navButtons.push(
      new ButtonBuilder()
        .setCustomId(`modpanel:permissions:cmdpage:${slotId}:${mode}:${page + 1}`)
        .setLabel("Page suivante ▶")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  navButtons.push(
    new ButtonBuilder()
      .setCustomId(`modpanel:permissions:cmdback:${slotId}`)
      .setLabel("Retour")
      .setStyle(ButtonStyle.Primary)
  );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(navButtons));

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

    // Multi-sélection ici aussi : plusieurs rôles/membres d'un coup.
    if (value === "addrole" || value === "removerole") {
      const select = new RoleSelectMenuBuilder()
        .setCustomId(`modpanel:permissions:roleselect:${slotId}:${value === "addrole" ? "add" : "remove"}`)
        .setPlaceholder("Choisis un ou plusieurs rôles")
        .setMinValues(1)
        .setMaxValues(25);
      return interaction.reply({ components: [actionRow(select)], ephemeral: true });
    }

    if (value === "addmember" || value === "removemember") {
      const select = new UserSelectMenuBuilder()
        .setCustomId(`modpanel:permissions:memberselect:${slotId}:${value === "addmember" ? "add" : "remove"}`)
        .setPlaceholder("Choisis un ou plusieurs membres")
        .setMinValues(1)
        .setMaxValues(25);
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

  // Sélection multiple : on applique tout d'un coup et on RESTE sur le
  // sélecteur, pour pouvoir enchaîner sur une autre page sans repasser par le
  // détail à chaque fois.
  if (view === "cmdpicker") {
    const slotId = Number(parts[3]);
    const mode = parts[4];
    const page = Number(parts[5]);
    const picked = interaction.values;

    if (!picked.length) return interaction.update(renderCommandPicker(guildId, slotId, mode, page));

    // Une commande publique est autorisée AVANT même de consulter les slots
    // (voir utils/accessControl.js) : l'attacher à une permission n'aurait
    // donc aucun effet tant qu'elle reste publique. On la bascule en
    // `configurable` pour que le réglage veuille dire quelque chose.
    const promoted = [];
    for (const commandName of picked) {
      if (mode === "add") {
        permissionsStore.addCommand(guildId, slotId, commandName);
        const command = loadAllCommands().get(commandName);
        if (command && effectiveLevel(command) === LEVEL.PUBLIC) {
          commandStateStore.setLevel(commandName, LEVEL.CONFIGURABLE);
          promoted.push(commandName);
        }
      } else {
        permissionsStore.removeCommand(guildId, slotId, commandName);
      }
    }

    const verb = mode === "add" ? "ajoutée" : "retirée";
    let note = `✅ ${picked.length} commande${picked.length > 1 ? "s" : ""} ${verb}${picked.length > 1 ? "s" : ""} : ${picked.join(", ")}`;
    if (promoted.length) {
      note +=
        `\n⚠️ ${promoted.join(", ")} ${promoted.length > 1 ? "étaient publiques" : "était publique"} : ` +
        "désormais réservée(s) aux permissions qui la/les contiennent. " +
        "Le niveau d'une commande vaut pour **tous les serveurs** du bot ; `&change` permet de revenir en arrière.";
    }
    // La liste des candidats a changé : on repart page 0 pour ne pas tomber
    // sur une page devenue vide.
    return interaction.update(renderCommandPicker(guildId, slotId, mode, 0, note));
  }

  if (view === "voiceactions") {
    const slotId = Number(parts[3]);
    permissionsStore.setVoiceActions(guildId, slotId, interaction.values);
    return interaction.update(renderDetail(guildId, slotId));
  }

  if (view === "cmdpage") {
    const slotId = Number(parts[3]);
    return interaction.update(renderCommandPicker(guildId, slotId, parts[4], Number(parts[5])));
  }

  if (view === "cmdback") {
    return interaction.update(renderDetail(guildId, Number(parts[3])));
  }

  if (view === "roleselect") {
    const slotId = Number(parts[3]);
    const mode = parts[4];
    for (const roleId of interaction.values) {
      if (mode === "add") permissionsStore.addRole(guildId, slotId, roleId);
      else permissionsStore.removeRole(guildId, slotId, roleId);
    }
    const list = interaction.values.map((r) => `<@&${r}>`).join(", ");
    await interaction.update({ content: `✅ ${mode === "add" ? "Ajouté" : "Retiré"} : ${list}`, components: [] });
    return;
  }

  if (view === "memberselect") {
    const slotId = Number(parts[3]);
    const mode = parts[4];
    for (const userId of interaction.values) {
      if (mode === "add") permissionsStore.addMember(guildId, slotId, userId);
      else permissionsStore.removeMember(guildId, slotId, userId);
    }
    const list = interaction.values.map((u) => `<@${u}>`).join(", ");
    await interaction.update({ content: `✅ ${mode === "add" ? "Ajouté" : "Retiré"} : ${list}`, components: [] });
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
