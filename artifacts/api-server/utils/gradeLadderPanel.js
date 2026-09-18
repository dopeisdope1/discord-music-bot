const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");
const ladderStore = require("./rankLadderStore");
const accessStore = require("./accessStore");
const permStore = require("./permissions/store");
const { PERMISSIONS, CATEGORY_LABELS, label: labelDe } = require("./permissions/catalog");
const messageOwner = require("./messageOwner");

// "&gradeladder"/"&gradeladder list" — panel enrichi (compteur de membres +
// badges d'accès par grade, sélecteur pour ouvrir la fiche d'un grade),
// demande explicite calquée sur la présentation d'un autre bot ("Gestion des
// grades"), remplie UNIQUEMENT avec les vraies données de CE bot :
//   - "Développeurs" = propriétaires du bot (BOT_OWNER_IDS) + rang sys
//     (utils/accessStore.js), le seul équivalent réel qu'on ait à un rang
//     "accès complet, hors hiérarchie" ;
//   - chaque grade = un rôle de l'échelle (utils/rankLadderStore.js), niveau
//     #1 = le plus haut (comme &promote/&demote) ;
//   - "Accès" d'un grade = les CATÉGORIES de permissions (utils/
//     permissions/catalog.js) que son rôle a reçues via &panel > Rôles et
//     permissions (utils/permissions/store.js::getRoleGrants) — jamais une
//     notion séparée, sinon panel et &gradeladder pourraient se contredire.
const CUSTOM_ID = "gradeladder";

const CATEGORIE_PAR_CLE = new Map(PERMISSIONS.map((p) => [p.key, p.category]));

/** Catégories distinctes accordées au rôle, triées comme CATEGORY_LABELS. */
function categoriesDuRole(guildId, roleId) {
  const cles = permStore.getRoleGrants(guildId, roleId);
  const categories = new Set(cles.map((k) => CATEGORIE_PAR_CLE.get(k)).filter(Boolean));
  return Object.keys(CATEGORY_LABELS).filter((c) => categories.has(c));
}

/** Un grade par rôle de l'échelle, du PLUS HAUT (niveau #1) au plus bas — même sens visuel que &promote. */
function grades(guild) {
  const ladder = ladderStore.getLadder(guild.id);
  return [...ladder].reverse().map((roleId, i) => {
    const role = guild.roles.cache.get(roleId);
    return {
      roleId,
      role,
      niveau: i + 1,
      membres: role?.members?.size ?? 0,
      categories: role ? categoriesDuRole(guild.id, roleId) : [],
    };
  });
}

function developpeurs(guild) {
  const ids = new Set([...accessStore.ownerIds(), ...accessStore.list("sys")]);
  return [...ids].filter((id) => guild.members?.cache?.has(id));
}

function ligneGrade(g) {
  const nom = g.role ? `${g.role}` : `*rôle supprimé (${g.roleId})*`;
  const acces = g.categories.length ? g.categories.map((c) => CATEGORY_LABELS[c]).join(" · ") : "aucune";
  return `**${nom}** · niveau \`#${g.niveau}\` · **${g.membres}** membre(s)\n**Accès :** ${acces}`;
}

/** Vue d'accueil : compteurs + un résumé compact par grade. */
function vueAccueil(guild) {
  const liste = grades(guild);
  const devs = developpeurs(guild);
  const totalGrades = new Set(liste.flatMap((g) => (g.role?.members ? [...g.role.members.keys()] : []))).size;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Gestion des grades"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Développeurs** : ${devs.length}\n**Grades configurés** : ${liste.length}\n**Utilisateurs gradés** : ${totalGrades}`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (!liste.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("*Aucune échelle configurée.* `gradeladder add @rôle` pour en ajouter (du plus bas au plus haut).")
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("**Sélectionne un grade** dans le menu pour ouvrir sa fiche."));
    for (const g of liste) {
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(ligneGrade(g)));
    }
  }
  return container;
}

/** Fiche d'un grade précis : rôle, membres (aperçu), permissions accordées en détail (pas que la catégorie). */
function vueFiche(guild, roleId) {
  const liste = grades(guild);
  const g = liste.find((x) => x.roleId === roleId);
  const container = new ContainerBuilder();

  if (!g) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Gestion des grades\nCe grade n'existe plus."));
    return container;
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Gestion des grades\n### ${g.role || `*rôle supprimé*`} — niveau \`#${g.niveau}\``)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const cles = g.role ? permStore.getRoleGrants(guild.id, roleId) : [];
  const permsTexte = cles.length ? cles.map((c) => `> \`${c}\` — ${labelDe(c)}`).join("\n") : "*Aucune permission accordée à ce rôle.*";
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**${g.membres} membre(s)**\n\n**Permissions accordées à ce rôle**\n${permsTexte}`)
  );

  if (g.role?.members && g.membres) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    const apercu = [...g.role.members.values()].slice(0, 15).map((m) => `<@${m.id}>`);
    const reste = g.membres - apercu.length;
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Membres**\n${apercu.join(", ")}${reste > 0 ? `, et ${reste} autre(s)` : ""}`)
    );
  }

  return container;
}

function buildGradeLadderPanel(guild, roleId = null) {
  const container = roleId ? vueFiche(guild, roleId) : vueAccueil(guild);
  const liste = grades(guild);

  if (liste.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    const options = liste
      .slice(0, 25)
      .map((g) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`#${g.niveau} ${g.role?.name || "rôle supprimé"}`.slice(0, 100))
          .setDescription(`${g.membres} membre(s)`.slice(0, 100))
          .setValue(g.roleId)
          .setDefault(g.roleId === roleId)
      );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:select`).setPlaceholder("Sélectionner un grade").addOptions(options)
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function repondreAvecGradeLadder(message) {
  return messageOwner.repondreEtRetenir(message, buildGradeLadderPanel(message.guild));
}

async function handleGradeLadderInteraction(interaction) {
  const [, action] = interaction.customId.split(":");
  if (action !== "select") return;
  return interaction.update(buildGradeLadderPanel(interaction.guild, interaction.values[0]));
}

module.exports = { CUSTOM_ID, buildGradeLadderPanel, repondreAvecGradeLadder, handleGradeLadderInteraction };
