const {
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");
const { can } = require("./permissions/engine");
const { checkHierarchy, checkBotPermission } = require("./moderation/actions");
const rankLadder = require("./rankLadderCommands");
const messageOwner = require("./messageOwner");

// "&grade <@membre>" — panneau par membre (demande explicite, calqué sur la
// présentation d'un autre bot) : la hiérarchie complète de l'échelle
// (&promote/&demote/&gradeladder, voir utils/rankLadderCommands.js) d'un
// coup d'œil, avec le grade actuel marqué, et un sélecteur pour SAUTER
// directement à n'importe quel grade — plus rapide que plusieurs
// &promote/&demote à la suite quand l'écart est grand. Même moteur, même
// permission ("members.rank.manage"), aucune deuxième échelle.
const CUSTOM_ID = "gradecard";
const PERMISSION = "members.rank.manage";

/** Niveau #1 = le plus haut, comme &promote/&gradeladder list — jamais l'ordre brut du tableau. */
function hierarchie(guild) {
  const ladder = rankLadder.ladderRoles(guild);
  return [...ladder].reverse().map((roleId, i) => ({ roleId, role: guild.roles.cache.get(roleId), niveau: i + 1, index: ladder.length - 1 - i }));
}

function buildGradeCard(guild, target) {
  const niveaux = hierarchie(guild);
  const idxActuel = rankLadder.currentIndex(guild, target);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Panneau de grade"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Cible** : ${target} — \`${target.id}\``,
        `**Grade actuel** : ${idxActuel === -1 ? "Aucun" : `${niveaux.find((n) => n.index === idxActuel)?.role || "*rôle supprimé*"} (niveau #${niveaux.find((n) => n.index === idxActuel)?.niveau})`}`,
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  if (!niveaux.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("*Aucune échelle configurée.* `gradeladder add @rôle` pour en ajouter (du plus bas au plus haut).")
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Hiérarchie**\n${niveaux
        .map((n) => `${n.role || "*rôle supprimé*"} — niveau \`#${n.niveau}\`${n.index === idxActuel ? " · **actuel**" : ""}`)
        .join("\n")}`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:set:${target.id}`)
        .setPlaceholder("Choisir un grade")
        .addOptions(
          niveaux.map((n) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`#${n.niveau} ${n.role?.name || "rôle supprimé"}`.slice(0, 100))
              .setValue(String(n.index))
              .setDefault(n.index === idxActuel)
          )
        )
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID}:remove:${target.id}`)
        .setLabel("Retirer le grade")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(idxActuel === -1),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:refresh:${target.id}`).setLabel("Actualiser").setStyle(ButtonStyle.Secondary)
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Retire le grade actuel (s'il y en a un) et ajoute `nextIndex` (ou rien si null) — un seul point de vérité pour set/remove. */
async function appliquerGrade(guild, moderateur, target, nextIndex) {
  const ladder = rankLadder.ladderRoles(guild);
  const idxActuel = rankLadder.currentIndex(guild, target);
  const raison = `Grade modifié par ${moderateur.tag}`;

  const me = guild.members.me;
  if (nextIndex !== null) {
    const nextRole = guild.roles.cache.get(ladder[nextIndex]);
    if (!nextRole) return "Ce grade n'existe plus — retape `&grade`.";
    if (me.roles.highest.position <= nextRole.position) return "Mon rôle est trop bas pour gérer ce grade — place-le plus haut dans la liste des rôles.";
  }

  try {
    if (idxActuel !== -1) await target.roles.remove(ladder[idxActuel], raison);
    if (nextIndex !== null) await target.roles.add(ladder[nextIndex], raison);
  } catch (err) {
    return `Discord a refusé : ${err.message}`;
  }
  return null;
}

async function repondreAvecGradeCard(message, target) {
  return messageOwner.repondreEtRetenir(message, buildGradeCard(message.guild, target));
}

async function handleGradeCardInteraction(interaction) {
  const [, action, targetId] = interaction.customId.split(":");
  if (!can(interaction.member, PERMISSION)) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }
  const target = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!target) return interaction.reply({ content: "Ce membre n'est plus sur le serveur.", flags: MessageFlags.Ephemeral });

  if (action === "refresh") return interaction.update(buildGradeCard(interaction.guild, target));

  const refusal = checkHierarchy(interaction.guild, interaction.member, target);
  if (refusal) return interaction.reply({ content: refusal, flags: MessageFlags.Ephemeral });
  const botPerm = checkBotPermission(interaction.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

  const nextIndex = action === "remove" ? null : Number(interaction.values[0]);
  const erreur = await appliquerGrade(interaction.guild, interaction.user, target, nextIndex);
  if (erreur) return interaction.reply({ content: erreur, flags: MessageFlags.Ephemeral });
  return interaction.update(buildGradeCard(interaction.guild, target));
}

module.exports = { CUSTOM_ID, buildGradeCard, repondreAvecGradeCard, handleGradeCardInteraction };
