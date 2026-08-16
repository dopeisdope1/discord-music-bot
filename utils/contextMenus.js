const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  ChannelSelectMenuBuilder,
  ChannelType,
  ActionRowBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { loadAllCommands } = require("./modCommandLoader");
const { checkAccess, isDisabled } = require("./accessControl");
const { registerHandler } = require("./modInteractionRegistry");
const { canDoVoiceAction } = require("./voiceAccess");
const { sendLog } = require("./actionLogger");
const { renderProfil } = require("./zinkiPanel");

// Entrées ajoutées au menu "clic droit sur un membre > Applications".
// Le clic droit NATIF de Discord ("Rendre muet sur le serveur", "Déplacer
// vers"...) n'est pas modifiable par un bot : il dépend uniquement des vraies
// permissions Discord du rôle. C'est le sous-menu Applications qui est notre
// seul point d'entrée. Discord y limite à 5 entrées de type "utilisateur",
// d'où les bascules muet/parole et sourd/écoute sur une seule entrée chacune.
//
// Les 4 entrées vocales exigent l'action vocale correspondante, accordée par
// slot dans &panel > Permissions (voir utils/voiceAccess.js) — inchangé.
// "Voir le profil" est gérée à part : elle exige la permission de la
// commande `zinki` (même moteur que les commandes texte, voir denyReason).
const MENUS = {
  "Déplacer en vocal": { action: "move" },
  "Muet vocal": { action: "mute" },
  "Sourd vocal": { action: "deaf" },
  "Déconnecter du vocal": { action: "disconnect" },
  "Voir le profil": { action: "profile", command: "zinki" },
};

function buildDefinitions() {
  return Object.keys(MENUS).map((name) =>
    new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User).toJSON()
  );
}

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

/**
 * Vérifie l'accès via le MÊME moteur que les commandes texte (slots de
 * &panel > Permissions). Retourne un message d'erreur, ou null si c'est bon.
 * Utilisé uniquement par les entrées liées à une commande (ex: "Voir le
 * profil" -> `zinki`), pas par les actions vocales (voir canDoVoiceAction).
 */
function denyReason(commandName, member) {
  const command = loadAllCommands().get(commandName);
  if (!command) return "Commande introuvable.";
  if (isDisabled(command)) return "Cette commande est désactivée.";
  if (!checkAccess(command, member).allowed) return "Tu n'as pas la permission d'utiliser ça.";
  return null;
}

// Hiérarchie : on bloque seulement si la cible est STRICTEMENT au-dessus.
// Un rôle égal passe, pour que des membres d'un même rôle (ex: "adhérent")
// puissent se gérer entre eux — sinon la permission `voc` ne servirait à rien
// entre pairs. Seul le propriétaire du serveur reste intouchable.
function hierarchyReason(interaction, target) {
  const me = interaction.guild.members.me;
  if (target.id === interaction.guild.ownerId) return "Impossible d'agir sur le propriétaire du serveur.";
  if (target.id === me.id) return "Je ne peux pas faire ça sur moi-même.";

  const actor = interaction.member;
  if (actor.id !== interaction.guild.ownerId && actor.roles.highest.position < target.roles.highest.position) {
    return "Ce membre a un rôle supérieur au tien.";
  }
  // Discord, lui, refuse toujours d'agir sur un rôle >= à celui du bot.
  if (me.roles.highest.position <= target.roles.highest.position) {
    return "Mon rôle est trop bas pour agir sur ce membre (place mon rôle plus haut dans la liste).";
  }
  return null;
}

async function handleContextMenu(interaction) {
  const menu = MENUS[interaction.commandName];
  if (!menu) return;

  const target = await interaction.guild.members.fetch({ user: interaction.targetId, force: true }).catch(() => null);
  if (!target) return interaction.reply(ephemeral("Membre introuvable."));

  const deny = menu.command
    ? denyReason(menu.command, interaction.member)
    : canDoVoiceAction(interaction.member, menu.action)
      ? null
      : "Tu n'as pas la permission de faire ça.";
  if (deny) return interaction.reply(ephemeral(`❌ ${deny}`));

  if (menu.action === "profile") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(await renderProfil(target, interaction.client, interaction.user.id));
  }

  const hierarchy = hierarchyReason(interaction, target);
  if (hierarchy) return interaction.reply(ephemeral(`❌ ${hierarchy}`));

  if (!target.voice.channel) {
    return interaction.reply(ephemeral(`**${target.user.tag}** n'est dans aucun salon vocal.`));
  }

  if (menu.action === "move") {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`ctxvoice:move:${target.id}`)
      .setPlaceholder("Choisis le salon vocal de destination")
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice);

    return interaction.reply({
      content: `Déplacer **${target.user.tag}** (actuellement dans ${target.voice.channel}) :`,
      components: [new ActionRowBuilder().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (menu.action === "mute") {
    const next = !target.voice.serverMute;
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MuteMembers)) {
      return interaction.reply(ephemeral("❌ Il me manque la permission **Rendre muet les membres**."));
    }
    await target.voice.setMute(next, `Clic droit — par ${interaction.user.tag}`);
    sendLog(interaction.client, interaction.guild.id, "voice", {
      title: next ? "Mute vocal" : "Unmute vocal",
      description: `${target.user.tag} ${next ? "rendu muet" : "a retrouvé la parole"} (clic droit).`,
      actor: interaction.user,
    });
    return interaction.reply(ephemeral(next ? `🔇 **${target.user.tag}** est muet.` : `🔊 **${target.user.tag}** a retrouvé la parole.`));
  }

  if (menu.action === "deaf") {
    const next = !target.voice.serverDeaf;
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.DeafenMembers)) {
      return interaction.reply(ephemeral("❌ Il me manque la permission **Rendre sourd les membres**."));
    }
    await target.voice.setDeaf(next, `Clic droit — par ${interaction.user.tag}`);
    sendLog(interaction.client, interaction.guild.id, "voice", {
      title: next ? "Deaf vocal" : "Undeaf vocal",
      description: `${target.user.tag} ${next ? "rendu sourd" : "a retrouvé l'écoute"} (clic droit).`,
      actor: interaction.user,
    });
    return interaction.reply(ephemeral(next ? `🔇 **${target.user.tag}** est sourd.` : `🔊 **${target.user.tag}** a retrouvé l'écoute.`));
  }

  if (menu.action === "disconnect") {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply(ephemeral("❌ Il me manque la permission **Déplacer les membres**."));
    }
    const from = target.voice.channel;
    await target.voice.setChannel(null, `Clic droit — par ${interaction.user.tag}`);
    sendLog(interaction.client, interaction.guild.id, "voice", {
      title: "Déconnexion vocale",
      description: `${target.user.tag} déconnecté de ${from} (clic droit).`,
      actor: interaction.user,
    });
    return interaction.reply(ephemeral(`⛔ **${target.user.tag}** a été déconnecté du vocal.`));
  }
}

// Sélection du salon de destination après "Déplacer en vocal".
async function handleMoveSelect(interaction) {
  const [, , targetId] = interaction.customId.split(":");

  const target = await interaction.guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  if (!target) return interaction.update({ content: "Membre introuvable.", components: [] });

  const deny =
    (canDoVoiceAction(interaction.member, "move") ? null : "Tu n'as pas la permission de déplacer un membre.") ||
    hierarchyReason(interaction, target);
  if (deny) return interaction.update({ content: `❌ ${deny}`, components: [] });

  if (!target.voice.channel) {
    return interaction.update({ content: `**${target.user.tag}** a quitté le vocal entre-temps.`, components: [] });
  }
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return interaction.update({ content: "❌ Il me manque la permission **Déplacer les membres**.", components: [] });
  }

  const channel = interaction.guild.channels.cache.get(interaction.values[0]);
  const from = target.voice.channel;
  await target.voice.setChannel(channel, `Clic droit — par ${interaction.user.tag}`);

  sendLog(interaction.client, interaction.guild.id, "voice", {
    title: "Déplacement vocal",
    description: `${target.user.tag} déplacé de ${from} vers ${channel} (clic droit).`,
    actor: interaction.user,
  });

  return interaction.update({ content: `✅ **${target.user.tag}** déplacé vers ${channel}.`, components: [] });
}

registerHandler("ctxvoice", handleMoveSelect);

module.exports = { buildDefinitions, handleContextMenu, MENUS };
