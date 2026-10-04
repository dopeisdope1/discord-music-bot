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
const levelStore = require("./permissions/levelStore");
const { LEVEL_MIN, LEVEL_MAX } = require("./permissions/levelCatalog");
const { can } = require("./permissions/engine");
const { roleAdmin } = require("./serverAdminCommands");
const messageOwner = require("./messageOwner");
const { majSure, banniereSurPanel, texteDUnEmbed } = require("./componentsV2");

// &p — raccourci direct vers les niveaux de permissions (1-9), SANS passer
// par &panel (accueil -> menu de familles -> sous-menu -> rubrique). Une
// ligne par niveau qui a au moins un rôle assigné, avec Supprimer/Gérer/
// Renommer juste dessous — rien d'autre. &panel > Niveaux garde ses options
// avancées pour qui en a besoin ; ceci est le chemin court pour tout le reste.
//
// Volontairement un fichier à part (comme utils/personalProtection.js) avec
// son propre préfixe de customId ("pal:") : aucune dépendance à la machine à
// états d'utils/configPanel.js.

const CUSTOM_ID = "pal";

/** Une ligne par niveau (1-9) qui a au moins un rôle assigné — calculées par computeTiers. */
function lignesPaliers(guild) {
  const guildId = guild.id;
  return computeTiers(guildId).map((t) => ({
    cle: `t-${t.index}`,
    niveau: t.index,
    libelle: `Niveau ${t.index}`,
    keys: t.keys,
    roleIds: t.roleIds.filter((id) => guild.roles.cache.has(id)),
  }));
}

function trouverLigne(guild, cle) {
  return lignesPaliers(guild).find((l) => l.cle === cle) || null;
}

// Discord plafonne un message à 40 composants, en comptant CHAQUE bouton
// d'une rangée séparément (pas juste la rangée) — un palier à un seul rôle
// coûte jusqu'à 5 composants (texte + rangée + 3 boutons) : 6 par page, mesuré
// avec marge.
const PAR_PAGE = 6;

/**
 * @param {{ addOpenKey?: string, manOpenKey?: string, page?: number }} [state]
 *   quel niveau a son sélecteur "Gérer" ou "Renommer/Supprimer" déplié, et
 *   quelle page de la liste afficher — jamais persisté, reconstruit à chaque
 *   clic à partir du bouton pressé (customId).
 */
function buildPalierPanel(guild, member, state = {}) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Rôles (niveaux)"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const lignes = lignesPaliers(guild);
  if (!lignes.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("*Aucun niveau n'est encore assigné à un rôle (voir &panel > Niveaux).*")
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const peutGerer = can(member, "panel.permissions.manage");
  const peutRoles = can(member, "server.roles.manage");
  const ouvert = lignes.find((l) => l.cle === state.addOpenKey || l.cle === state.manOpenKey) || null;
  const pages = Math.max(1, Math.ceil(lignes.length / PAR_PAGE));
  const page = Math.min(Math.max(0, Number(state.page) || 0), pages - 1);

  // Un niveau "ouvert" (Gérer/Renommer/Supprimer en cours) REMPLACE la liste
  // plutôt que d'empiler ses contrôles en plus : à plusieurs dizaines de
  // composants déjà pour la liste seule, les additionner aurait vite dépassé
  // le plafond de 40.
  const aAfficher = ouvert ? [ouvert] : lignes.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE);

  for (const ligne of aAfficher) {
    const roles = ligne.roleIds.length ? ligne.roleIds.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle*";
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${ligne.libelle}** : ${roles}`));
    if (!peutGerer) continue;

    if (ligne.roleIds.length === 1 && peutRoles) {
      // Un seul rôle (le cas normal) : les boutons agissent directement dessus.
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:del:${ligne.roleIds[0]}`).setLabel("Supprimer").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:addopen:${ligne.cle}:${page}`).setLabel("Gérer").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:ren:${ligne.roleIds[0]}`).setLabel("Renommer").setStyle(ButtonStyle.Primary)
        )
      );
    } else {
      // Plusieurs rôles (ou aucun) : Supprimer/Renommer viseraient un rôle au
      // hasard sans préciser lequel — "Renommer/Supprimer" déplie deux petits
      // sélecteurs juste en dessous.
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${CUSTOM_ID}:addopen:${ligne.cle}:${page}`).setLabel("Gérer").setStyle(ButtonStyle.Success),
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
            .setPlaceholder(`Choisir le rôle à assigner au ${ligne.libelle}`.slice(0, 150))
        )
      );
      // "Déplacer" — change le niveau d'un rôle déjà assigné (équivalent du
      // glisser-déposer natif de Discord appliqué à ce rôle). N'a de sens que
      // pour un niveau à UN SEUL rôle (sinon "lequel ?").
      if (ligne.roleIds.length === 1) {
        const autresNiveaux = [];
        for (let n = LEVEL_MIN; n <= LEVEL_MAX; n++) {
          if (n !== ligne.niveau) autresNiveaux.push(n);
        }
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${CUSTOM_ID}:move:${ligne.roleIds[0]}:${page}`)
              .setPlaceholder("Déplacer ce rôle vers un autre niveau")
              .addOptions(autresNiveaux.map((n) => new StringSelectMenuOptionBuilder().setLabel(`Niveau ${n}`).setValue(String(n))))
          )
        );
      }
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

/**
 * Adapte une interaction en "message" minimal pour réutiliser TEL QUEL
 * utils/serverAdminCommands.js::roleAdmin (rename/delete, confirmation
 * incluse).
 */
function messageFromInteraction(interaction) {
  return {
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    author: interaction.user,
    mentions: { roles: { first: () => null } },
    retour: (i) => buildPalierPanel(i.guild, i.member, {}),
    reply: (payload) => {
      const embedSeul = payload?.embeds?.length && !payload.files?.length && !payload.components?.length;
      if (!embedSeul) return majSure(interaction, payload);
      const { texte } = texteDUnEmbed(payload.embeds[0]);
      return majSure(interaction, banniereSurPanel(buildPalierPanel(interaction.guild, interaction.member, {}), texte));
    },
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
    if (!ligne) return interaction.reply({ content: "Ce niveau n'existe plus — retape &p.", flags: MessageFlags.Ephemeral });
    const roleId = interaction.values[0];
    levelStore.setRoleLevel(guild.id, roleId, ligne.niveau);
    return interaction.update(buildPalierPanel(guild, member, { page }));
  }

  // "Déplacer vers un autre niveau" — p1 = l'ID du rôle déplacé, p2 = la page
  // d'origine (pour y revenir), interaction.values[0] = niveau cible.
  if (action === "move") {
    const roleId = p1;
    const page = Number(p2) || 0;
    if (!guild.roles.cache.has(roleId)) {
      return interaction.reply({ content: "Ce rôle n'existe plus.", flags: MessageFlags.Ephemeral });
    }
    const niveauCible = parseInt(interaction.values[0], 10);
    if (!Number.isInteger(niveauCible) || niveauCible < LEVEL_MIN || niveauCible > LEVEL_MAX) {
      return interaction.reply({ content: "Niveau invalide.", flags: MessageFlags.Ephemeral });
    }
    levelStore.setRoleLevel(guild.id, roleId, niveauCible);
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
