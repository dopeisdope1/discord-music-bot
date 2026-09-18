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
const accessStore = require("./accessStore");
const rankLadder = require("./rankLadderCommands");
const permStore = require("./permissions/store");
const { commandsForKeys } = require("./permsCommands");
const { getPrefixes } = require("./prefixStore");
const messageOwner = require("./messageOwner");

// "&staff [@membre]" — carte "Staff · Owner/Sys" (demande explicite, calquée
// sur la présentation d'un autre bot) : statut Owner/Sys + grade (échelle
// &promote/&demote, voir utils/gradeLadderPanel.js) + permissions
// accordées, avec un sélecteur pour BASCULER le rang sys — réservé au
// propriétaire du bot.
//
// Owner reste volontairement EN LECTURE SEULE, jamais un bouton à cocher :
// il vient de BOT_OWNER_IDS (variable d'env, voir utils/accessStore.js),
// pas d'un fichier modifiable par une commande — seule façon de garantir
// qu'il ne peut jamais être accordé par accident ou par un compte
// compromis. Le rang sys, lui, EST modifiable (utils/accessStore.js::add/
// remove, déjà utilisé par &sys/&unsys) : c'est la seule bascule proposée
// ici, jamais Owner.
const CUSTOM_ID = "staffcard";

function gradeDe(guild, member) {
  const idx = rankLadder.currentIndex(guild, member);
  if (idx < 0) return "Aucun";
  const ladder = rankLadder.ladderRoles(guild);
  const roleId = ladder[idx];
  const role = guild.roles.cache.get(roleId);
  return role ? `${role} (niveau #${ladder.length - idx})` : `niveau #${ladder.length - idx}`;
}

function buildStaffCard(guild, target, viewerId) {
  const owner = accessStore.isOwner(target.id);
  const sys = accessStore.isSys(target.id);
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Staff · Owner / Sys"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Cible** : ${target} — \`${target.id}\``,
        `**Pseudo** : ${target.user?.tag || target.user?.username || target.id}`,
        `**Grade** : ${gradeDe(guild, target)}`,
        "",
        `**Owner** : ${owner ? "✅" : "❌"}`,
        `**Sys** : ${sys ? "✅" : "❌"}`,
      ].join("\n")
    )
  );

  // Les permissions accordées par rôle/individuellement restent affichées
  // même pour un Owner/Sys (déjà tout, elles n'ajoutent rien) — c'est le
  // service originel de "&staff check" : voir ce qu'un membre débloque
  // RÉELLEMENT via ses rôles, peu importe son rang.
  const keys = new Set(permStore.getUserGrants(guild.id, target.id));
  for (const roleId of target.roles?.cache?.keys?.() || []) {
    for (const k of permStore.getRoleGrants(guild.id, roleId)) keys.add(k);
  }
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  if (owner || sys) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        owner
          ? "*Owner : propriétaire du bot, accès total sur tous les serveurs — les permissions accordées par rôle n'ont aucun effet en plus.*"
          : "*Sys : accès total sur ce serveur (sauf distribuer le rang sys) — les permissions accordées par rôle n'ont aucun effet en plus.*"
      )
    );
  } else if (!keys.size) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("*N'a aucune permission particulière accordée sur ce serveur.*"));
  } else {
    const commands = commandsForKeys([...keys]);
    const prefixe = getPrefixes(guild.id).musicMod;
    const lines = [`**Commandes débloquées (${commands.length})** :`];
    if (!commands.length) {
      lines.push("*aucune*");
    } else {
      const MAX = 20;
      lines.push(commands.slice(0, MAX).map((c) => `\`${prefixe}${c}\``).join(", "));
      const reste = commands.length - MAX;
      if (reste > 0) lines.push(`+${reste} autre(s) — voir \`&panel\` > Rôles et permissions`);
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
  }

  // Owner n'est jamais proposé : voir le commentaire en tête de fichier.
  if (accessStore.isOwner(viewerId) && !owner) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:toggle:${target.id}`)
          .setPlaceholder("Rang sys")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Ajouter le rang sys").setValue("add").setDefault(false),
            new StringSelectMenuOptionBuilder().setLabel("Retirer le rang sys").setValue("remove").setDefault(false)
          )
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function repondreAvecStaffCard(message, target) {
  return messageOwner.repondreEtRetenir(message, buildStaffCard(message.guild, target, message.author.id));
}

async function handleStaffCardInteraction(interaction) {
  const [, action, targetId] = interaction.customId.split(":");
  if (action !== "toggle") return;
  // Réservé au propriétaire du bot, comme &sys/&unsys — jamais accordable
  // par rôle ou par le rang sys lui-même (voir utils/accessStore.js).
  if (!accessStore.isOwner(interaction.user.id)) {
    return interaction.reply({ content: "Réservé au propriétaire du bot.", flags: MessageFlags.Ephemeral });
  }
  const choix = interaction.values[0];
  if (choix === "add") accessStore.add("sys", targetId);
  else if (choix === "remove") accessStore.remove("sys", targetId);
  const target = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!target) return interaction.reply({ content: "Ce membre n'est plus sur le serveur.", flags: MessageFlags.Ephemeral });
  return interaction.update(buildStaffCard(interaction.guild, target, interaction.user.id));
}

module.exports = { CUSTOM_ID, buildStaffCard, repondreAvecStaffCard, handleStaffCardInteraction };
