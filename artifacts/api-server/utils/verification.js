const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const verificationStore = require("./verificationStore");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

const ID = "verify";

function card(title, body) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${body}`));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${ID}:claim`).setLabel("Se vérifier").setStyle(ButtonStyle.Success))
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * &verify setup [@rôle] — règle (si donné) le rôle de vérification et poste
 * le bouton dans le salon courant. Sans rôle déjà configuré (ni fourni ici),
 * il n'y a rien à donner en cliquant : on le dit plutôt que de poster un
 * bouton qui échouerait silencieusement.
 */
async function setupVerification(client, message, args) {
  if (!can(message.member, "members.verification.manage")) return;
  const role = message.mentions.roles?.first();
  if (role) verificationStore.setRole(message.guild.id, role.id);

  const config = verificationStore.getConfig(message.guild.id);
  if (!config.roleId) {
    return reply(message, "error", "Indique un rôle : `verify setup @rôle` (ou choisis-le d'abord dans `&panel` > Membres).");
  }
  if (!message.guild.roles.cache.has(config.roleId)) {
    return reply(message, "error", "Le rôle configuré n'existe plus — choisis-en un nouveau : `verify setup @rôle`.");
  }

  verificationStore.setChannel(message.guild.id, message.channel.id);
  await message.channel.send(card("Vérification", "Clique ci-dessous pour accéder au reste du serveur."));
  await reply(message, "success", "Message de vérification envoyé dans ce salon.");
}

/** Toutes les interactions "verify:claim" (voir index.js). */
async function handleVerifyButton(interaction) {
  const [, action] = interaction.customId.split(":");
  if (action !== "claim") return;

  const { roleId } = verificationStore.getConfig(interaction.guild.id);
  const role = roleId && interaction.guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.reply({ content: "La vérification n'est plus configurée sur ce serveur.", flags: MessageFlags.Ephemeral });
  }

  const member = interaction.member;
  if (member.roles.cache.has(role.id)) {
    return interaction.reply({ content: "Tu es déjà vérifié·e.", flags: MessageFlags.Ephemeral });
  }

  try {
    await member.roles.add(role, "Vérification");
  } catch (err) {
    return interaction.reply({ content: `Discord a refusé : ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ content: `Vérifié·e — le rôle ${role} t'a été attribué.`, flags: MessageFlags.Ephemeral });
}

module.exports = { setupVerification, handleVerifyButton, ID };
