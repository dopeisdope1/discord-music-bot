const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { computeTiers } = require("./permsCommands");
const permStore = require("./permissions/store");
const { can } = require("./permissions/engine");
const { roleAdmin } = require("./serverAdminCommands");
const messageOwner = require("./messageOwner");

// &p — raccourci direct vers les paliers de permissions, SANS passer par
// &panel (accueil -> menu de familles -> sous-menu -> rubrique). Demande
// explicite : la version dans &panel est devenue incompréhensible à force
// d'options (pagination, palier "ouvert" qui remplace la liste, nommer un
// palier, nettoyer, provisionnement en masse...). Celle-ci ne fait qu'UNE
// chose : une ligne par palier, avec Supprimer/Ajouter/Renommer juste
// dessous — rien d'autre. &panel > Rôles (paliers) garde ses options
// avancées pour qui en a besoin ; ceci est le chemin court pour tout le
// reste.
//
// Volontairement un fichier à part (comme utils/personalProtection.js) avec
// son propre préfixe de customId ("pal:") : aucune dépendance à la machine à
// états d'utils/configPanel.js, donc aucun risque d'y réintroduire un bug en
// touchant à celle-ci, et inversement.

const CUSTOM_ID = "pal";

/** Un palier = un numéro (paliers réels, calculés par computeTiers) ou une étiquette de groupe exclusif. */
function lignesPaliers(guild) {
  const guildId = guild.id;
  const lignes = computeTiers(guildId).map((t) => ({
    cle: `t-${t.index}`,
    libelle: `Permission ${t.index}`,
    keys: t.keys,
    roleIds: t.roleIds.filter((id) => guild.roles.cache.has(id)),
    exclusiveLabel: null,
  }));

  // Les rôles "exclusifs" ne partagent pas forcément le même ensemble de
  // clés (l'étiquette n'est qu'un regroupement cosmétique) — "Ajouter"
  // reprend celles du premier rôle du groupe comme base la plus raisonnable.
  const parLabel = new Map();
  for (const id of permStore.listExclusiveRoles(guildId)) {
    if (!guild.roles.cache.has(id)) continue;
    const label = permStore.getExclusiveLabel(guildId, id) || "__sans_label__";
    if (!parLabel.has(label)) parLabel.set(label, []);
    parLabel.get(label).push(id);
  }
  for (const [label, ids] of parLabel) {
    lignes.push({
      cle: `e-${label}`,
      libelle: label === "__sans_label__" ? "Exclusives" : label,
      keys: permStore.getRoleGrants(guildId, ids[0]),
      roleIds: ids,
      exclusiveLabel: label === "__sans_label__" ? null : label,
    });
  }
  return lignes;
}

function trouverLigne(guild, cle) {
  return lignesPaliers(guild).find((l) => l.cle === cle) || null;
}

/**
 * @param {{ addOpenKey?: string, manOpenKey?: string }} [state] quel palier a
 *   son sélecteur "Ajouter" ou "Renommer/Supprimer" déplié — jamais persisté,
 *   reconstruit à chaque clic à partir du bouton pressé.
 */
function buildPalierPanel(guild, member, state = {}) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Rôles (paliers)"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const lignes = lignesPaliers(guild);
  if (!lignes.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("*Aucune permission n'est encore accordée à un rôle (voir &panel > Rôles et permissions).*")
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const peutGerer = can(member, "panel.permissions.manage");
  const peutRoles = can(member, "server.roles.manage");

  for (const ligne of lignes) {
    const roles = ligne.roleIds.length ? ligne.roleIds.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle*";
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${ligne.libelle}** : ${roles}`));
    if (!peutGerer) continue;

    if (ligne.roleIds.length === 1 && peutRoles) {
      // Un seul rôle (le cas normal, voir utils/rolePresets.js) : les
      // boutons agissent directement dessus.
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:del:${ligne.roleIds[0]}`).setLabel("Supprimer").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:addopen:${ligne.cle}`).setLabel("Ajouter").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:ren:${ligne.roleIds[0]}`).setLabel("Renommer").setStyle(ButtonStyle.Primary)
        )
      );
    } else {
      // Plusieurs rôles (ou aucun) : Supprimer/Renommer viseraient un rôle au
      // hasard sans préciser lequel — "Renommer/Supprimer" déplie deux petits
      // sélecteurs juste en dessous.
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:addopen:${ligne.cle}`).setLabel("Ajouter").setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_ID}:manopen:${ligne.cle}`)
            .setLabel("Renommer/Supprimer")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!ligne.roleIds.length || !peutRoles)
        )
      );
    }

    if (state.addOpenKey === ligne.cle) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(`${CUSTOM_ID}:add:${ligne.cle}`)
            .setPlaceholder(`Choisir le rôle à ajouter à ${ligne.libelle}`.slice(0, 150))
        )
      );
    }
    if (state.manOpenKey === ligne.cle && peutRoles && ligne.roleIds.length) {
      const options = ligne.roleIds
        .slice(0, 25)
        .map((id) => new StringSelectMenuOptionBuilder().setLabel((guild.roles.cache.get(id)?.name || id).slice(0, 100)).setValue(id));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:renpick:${ligne.cle}`).setPlaceholder("Renommer quel rôle ?").addOptions(options)
        )
      );
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:delpick:${ligne.cle}`).setPlaceholder("Supprimer quel rôle ?").addOptions(options)
        )
      );
    }
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** &p — public en lecture (comme &helpall) : les boutons n'apparaissent que pour qui a le droit de s'en servir. */
async function handlePalierTextCommand(client, message) {
  return messageOwner.repondreEtRetenir(message, buildPalierPanel(message.guild, message.member, {}));
}

/** Adapte une interaction en "message" minimal pour réutiliser TEL QUEL utils/serverAdminCommands.js::roleAdmin (rename/delete, confirmation incluse). */
function messageFromInteraction(interaction) {
  return {
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    author: interaction.user,
    mentions: { roles: { first: () => null } },
    reply: (payload) => interaction.update(payload),
  };
}

function ouvrirModaleRenommage(interaction, role) {
  const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:ren:${role.id}`).setTitle("Renommer le rôle");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(role.name)
    )
  );
  return interaction.showModal(modal);
}

async function handlePalierInteraction(interaction) {
  const [, action, cle] = interaction.customId.split(":");
  const { member, guild } = interaction;

  if (!can(member, "panel.permissions.manage")) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }

  if (action === "addopen") return interaction.update(buildPalierPanel(guild, member, { addOpenKey: cle }));
  if (action === "manopen") return interaction.update(buildPalierPanel(guild, member, { manOpenKey: cle }));

  if (action === "add") {
    const ligne = trouverLigne(guild, cle);
    if (!ligne) return interaction.reply({ content: "Ce palier n'existe plus — retape &p.", flags: MessageFlags.Ephemeral });
    const roleId = interaction.values[0];
    permStore.setRoleGrants(guild.id, roleId, ligne.keys);
    if (ligne.exclusiveLabel) permStore.setRoleExclusive(guild.id, roleId, true, ligne.exclusiveLabel);
    return interaction.update(buildPalierPanel(guild, member, {}));
  }

  // Renommer/Supprimer un rôle exigent en plus server.roles.manage (même
  // droit que &role rename/delete) — panel.permissions.manage seul ne
  // suffit pas à modifier le rôle Discord lui-même.
  if (!can(member, "server.roles.manage")) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }

  if (action === "ren") {
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rôle inchangé.", flags: MessageFlags.Ephemeral });
      await roleAdmin(interaction.client, messageFromInteraction(interaction), ["rename", cle, ...name.split(/\s+/)]);
      return;
    }
    const role = guild.roles.cache.get(cle);
    if (!role) return interaction.reply({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
    return ouvrirModaleRenommage(interaction, role);
  }

  if (action === "del") {
    return roleAdmin(interaction.client, messageFromInteraction(interaction), ["delete", cle]);
  }

  if (action === "renpick") {
    const roleId = interaction.values[0];
    const role = guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
    return ouvrirModaleRenommage(interaction, role);
  }

  if (action === "delpick") {
    return roleAdmin(interaction.client, messageFromInteraction(interaction), ["delete", interaction.values[0]]);
  }
}

module.exports = { buildPalierPanel, handlePalierTextCommand, handlePalierInteraction, lignesPaliers, CUSTOM_ID };
