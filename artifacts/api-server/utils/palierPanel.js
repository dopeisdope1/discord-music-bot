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

// Discord plafonne un message à 40 composants, en comptant CHAQUE bouton
// d'une rangée séparément (pas juste la rangée) — erreur commise à
// l'écriture initiale de ce fichier, découverte en production
// (COMPONENT_MAX_TOTAL_COMPONENTS_EXCEEDED dès le premier "&p" sur un
// serveur à 16 paliers). Un palier à un seul rôle coûte jusqu'à 5
// composants (texte + rangée + 3 boutons) : 6 par page, mesuré avec marge,
// pas deviné — voir le test dédié qui compte les VRAIS composants pour
// chaque page et chaque état.
const PAR_PAGE = 6;

/**
 * @param {{ addOpenKey?: string, manOpenKey?: string, page?: number }} [state]
 *   quel palier a son sélecteur "Ajouter" ou "Renommer/Supprimer" déplié, et
 *   quelle page de la liste afficher — jamais persisté, reconstruit à chaque
 *   clic à partir du bouton pressé (customId).
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
  const ouvert = lignes.find((l) => l.cle === state.addOpenKey || l.cle === state.manOpenKey) || null;
  const pages = Math.max(1, Math.ceil(lignes.length / PAR_PAGE));
  const page = Math.min(Math.max(0, Number(state.page) || 0), pages - 1);

  // Un palier "ouvert" (Ajouter/Renommer/Supprimer en cours) REMPLACE la
  // liste plutôt que d'empiler ses contrôles en plus : à plusieurs dizaines
  // de composants déjà pour la liste seule, les additionner aurait vite
  // dépassé le plafond de 40.
  const aAfficher = ouvert ? [ouvert] : lignes.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE);

  for (const ligne of aAfficher) {
    const roles = ligne.roleIds.length ? ligne.roleIds.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle*";
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${ligne.libelle}** : ${roles}`));
    if (!peutGerer) continue;

    if (ligne.roleIds.length === 1 && peutRoles) {
      // Un seul rôle (le cas normal, voir utils/rolePresets.js) : les
      // boutons agissent directement dessus.
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:del:${ligne.roleIds[0]}`).setLabel("Supprimer").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:addopen:${ligne.cle}:${page}`).setLabel("Ajouter").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:ren:${ligne.roleIds[0]}`).setLabel("Renommer").setStyle(ButtonStyle.Primary)
        )
      );
    } else {
      // Plusieurs rôles (ou aucun) : Supprimer/Renommer viseraient un rôle au
      // hasard sans préciser lequel — "Renommer/Supprimer" déplie deux petits
      // sélecteurs juste en dessous.
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:addopen:${ligne.cle}:${page}`).setLabel("Ajouter").setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_ID}:manopen:${ligne.cle}:${page}`)
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
            .setCustomId(`${CUSTOM_ID}:add:${ligne.cle}:${page}`)
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

  if (ouvert) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:page:${page}`).setLabel("◀ Retour à la liste").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (pages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:page:${page - 1}`)
          .setLabel("◀ Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:page:${page + 1}`)
          .setLabel(`Page ${page + 1}/${pages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= pages - 1)
      )
    );
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
  // p1/p2 selon l'action : "addopen"/"manopen"/"add" portent <cle>:<page> ;
  // "page" porte juste <page> ; "ren"/"del" portent <roleId> ; "renpick"/
  // "delpick" sont des sélecteurs, la cible vient de interaction.values.
  const [, action, p1, p2] = interaction.customId.split(":");
  const { member, guild } = interaction;

  if (!can(member, "panel.permissions.manage")) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }

  if (action === "addopen") return interaction.update(buildPalierPanel(guild, member, { addOpenKey: p1, page: Number(p2) || 0 }));
  if (action === "manopen") return interaction.update(buildPalierPanel(guild, member, { manOpenKey: p1, page: Number(p2) || 0 }));
  // "page" sert aussi de "Retour à la liste" — sans addOpenKey/manOpenKey,
  // buildPalierPanel retombe sur la liste paginée normale.
  if (action === "page") return interaction.update(buildPalierPanel(guild, member, { page: Number(p1) || 0 }));

  if (action === "add") {
    const cle = p1;
    const page = Number(p2) || 0;
    const ligne = trouverLigne(guild, cle);
    if (!ligne) return interaction.reply({ content: "Ce palier n'existe plus — retape &p.", flags: MessageFlags.Ephemeral });
    const roleId = interaction.values[0];
    permStore.setRoleGrants(guild.id, roleId, ligne.keys);
    if (ligne.exclusiveLabel) permStore.setRoleExclusive(guild.id, roleId, true, ligne.exclusiveLabel);
    return interaction.update(buildPalierPanel(guild, member, { page }));
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
      await roleAdmin(interaction.client, messageFromInteraction(interaction), ["rename", p1, ...name.split(/\s+/)]);
      return;
    }
    const role = guild.roles.cache.get(p1);
    if (!role) return interaction.reply({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
    return ouvrirModaleRenommage(interaction, role);
  }

  if (action === "del") {
    return roleAdmin(interaction.client, messageFromInteraction(interaction), ["delete", p1]);
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
