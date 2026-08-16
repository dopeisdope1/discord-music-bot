const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { buildCard, payload } = require("./panelComponents");
const { registerHandler } = require("./modInteractionRegistry");
const { canDoVoiceAction } = require("./voiceAccess");
const { sendLog } = require("./actionLogger");

// Deux façons de donner l'accès, au choix (voir utils/voiceAccess.js) :
//  - la commande `voc` dans un slot de &panel > Permissions (accès complet) ;
//  - un rôle dans &panel > Voice Master (limité aux actions cochées).
const PERMISSION = "voc";

const canUse = (member) => canDoVoiceAction(member);

// Hiérarchie : on bloque seulement si la cible est STRICTEMENT au-dessus.
// Un rôle égal passe, pour que des membres d'un même rôle (ex: "adhérent")
// puissent se gérer entre eux — sinon la permission `voc` ne servirait à rien
// entre pairs. Seul le propriétaire du serveur reste intouchable.
function hierarchyReason(guild, actor, target) {
  const me = guild.members.me;
  if (target.id === guild.ownerId) return "Impossible d'agir sur le propriétaire du serveur.";
  if (target.id === me.id) return "Je ne peux pas faire ça sur moi-même.";
  if (actor.id !== guild.ownerId && actor.roles.highest.position < target.roles.highest.position) {
    return "Ce membre a un rôle supérieur au tien.";
  }
  // Discord, lui, refuse toujours d'agir sur un rôle >= à celui du bot.
  if (me.roles.highest.position <= target.roles.highest.position) {
    return "Mon rôle est trop bas pour agir sur ce membre (place mon rôle plus haut dans la liste).";
  }
  return null;
}

function botMissing(guild, flag, label) {
  return guild.members.me.permissions.has(flag) ? null : `Il me manque la permission **${label}**.`;
}

function render(target, invokerId, note) {
  const voice = target.voice;
  const inVoice = Boolean(voice.channel);

  const container = buildCard({
    title: `Gestion vocale — ${target.displayName}`,
    description: note || undefined,
    thumbnail: target.displayAvatarURL({ size: 256 }),
    fields: [
      { name: "Salon", value: inVoice ? `${voice.channel}` : "aucun (hors vocal)" },
      { name: "Micro", value: voice.serverMute ? "coupé par le serveur" : "actif" },
      { name: "Casque", value: voice.serverDeaf ? "coupé par le serveur" : "actif" },
    ],
  });

  const id = (action) => `voc:${action}:${target.id}:${invokerId}`;

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(id("mute"))
        .setLabel(voice.serverMute ? "Rendre la parole" : "Rendre muet")
        .setStyle(voice.serverMute ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!inVoice),
      new ButtonBuilder()
        .setCustomId(id("deaf"))
        .setLabel(voice.serverDeaf ? "Réactiver le casque" : "Mettre en sourdine")
        .setStyle(voice.serverDeaf ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!inVoice)
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(id("move"))
        .setLabel("Déplacer vers")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!inVoice),
      new ButtonBuilder()
        .setCustomId(id("disconnect"))
        .setLabel("Déconnecter")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!inVoice),
      new ButtonBuilder().setCustomId(id("refresh")).setLabel("⟳").setStyle(ButtonStyle.Secondary)
    )
  );

  return payload(container);
}

async function handle(interaction) {
  const [, action, targetId, invokerId] = interaction.customId.split(":");

  // Re-vérifié à CHAQUE clic, pas seulement à l'ouverture : la permission a
  // pu être retirée entre-temps, et n'importe qui peut cliquer sur le panneau.
  if (interaction.user.id !== invokerId) {
    return interaction.reply({ content: "Seule la personne qui a lancé la commande peut utiliser ce panneau.", flags: MessageFlags.Ephemeral });
  }
  if (!canUse(interaction.member)) {
    return interaction.reply({ content: "❌ Tu n'as pas la permission de gérer le vocal.", flags: MessageFlags.Ephemeral });
  }

  // Un rôle Voice Master peut n'avoir qu'une partie des actions : on vérifie
  // aussi l'action précise, pas seulement l'accès général au panneau.
  const actionPermission = { moveto: "move", move: "move", mute: "mute", deaf: "deaf", disconnect: "disconnect" }[action];
  if (actionPermission && !canDoVoiceAction(interaction.member, actionPermission)) {
    return interaction.reply({ content: "❌ Cette action ne t'est pas autorisée.", flags: MessageFlags.Ephemeral });
  }

  const target = await interaction.guild.members.fetch({ user: targetId, force: true }).catch(() => null);
  if (!target) {
    return interaction.reply({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
  }

  if (action === "refresh") return interaction.update(render(target, invokerId));

  if (action === "move") {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`voc:moveto:${target.id}:${invokerId}`)
      .setPlaceholder("Choisis le salon vocal de destination")
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice);
    return interaction.reply({
      content: `Déplacer **${target.user.tag}** :`,
      components: [new ActionRowBuilder().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const hierarchy = hierarchyReason(interaction.guild, interaction.member, target);
  if (hierarchy) return interaction.reply({ content: `❌ ${hierarchy}`, flags: MessageFlags.Ephemeral });

  if (!target.voice.channel) {
    return interaction.update(render(target, invokerId, `**${target.user.tag}** a quitté le vocal.`));
  }

  if (action === "moveto") {
    const missing = botMissing(interaction.guild, PermissionFlagsBits.MoveMembers, "Déplacer les membres");
    if (missing) return interaction.update({ content: `❌ ${missing}`, components: [] });

    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    const from = target.voice.channel;
    await target.voice.setChannel(channel, `Panneau vocal — par ${interaction.user.tag}`);

    sendLog(interaction.client, interaction.guild.id, "voice", {
      title: "Déplacement vocal",
      description: `${target.user.tag} déplacé de ${from} vers ${channel}.`,
      actor: interaction.user,
    });
    return interaction.update({ content: `✅ **${target.user.tag}** déplacé vers ${channel}.`, components: [] });
  }

  if (action === "mute") {
    const missing = botMissing(interaction.guild, PermissionFlagsBits.MuteMembers, "Rendre muet les membres");
    if (missing) return interaction.reply({ content: `❌ ${missing}`, flags: MessageFlags.Ephemeral });

    const next = !target.voice.serverMute;
    await target.voice.setMute(next, `Panneau vocal — par ${interaction.user.tag}`);
    sendLog(interaction.client, interaction.guild.id, "voice", {
      title: next ? "Mute vocal" : "Unmute vocal",
      description: `${target.user.tag} ${next ? "rendu muet" : "a retrouvé la parole"}.`,
      actor: interaction.user,
    });
    return interaction.update(render(target, invokerId, next ? "Micro coupé." : "Micro réactivé."));
  }

  if (action === "deaf") {
    const missing = botMissing(interaction.guild, PermissionFlagsBits.DeafenMembers, "Rendre sourd les membres");
    if (missing) return interaction.reply({ content: `❌ ${missing}`, flags: MessageFlags.Ephemeral });

    const next = !target.voice.serverDeaf;
    await target.voice.setDeaf(next, `Panneau vocal — par ${interaction.user.tag}`);
    sendLog(interaction.client, interaction.guild.id, "voice", {
      title: next ? "Deaf vocal" : "Undeaf vocal",
      description: `${target.user.tag} ${next ? "mis en sourdine" : "a retrouvé l'écoute"}.`,
      actor: interaction.user,
    });
    return interaction.update(render(target, invokerId, next ? "Casque coupé." : "Casque réactivé."));
  }

  if (action === "disconnect") {
    const missing = botMissing(interaction.guild, PermissionFlagsBits.MoveMembers, "Déplacer les membres");
    if (missing) return interaction.reply({ content: `❌ ${missing}`, flags: MessageFlags.Ephemeral });

    const from = target.voice.channel;
    await target.voice.setChannel(null, `Panneau vocal — par ${interaction.user.tag}`);
    sendLog(interaction.client, interaction.guild.id, "voice", {
      title: "Déconnexion vocale",
      description: `${target.user.tag} déconnecté de ${from}.`,
      actor: interaction.user,
    });

    const refreshed = await interaction.guild.members.fetch({ user: targetId, force: true }).catch(() => target);
    return interaction.update(render(refreshed, invokerId, `Déconnecté de ${from}.`));
  }
}

registerHandler("voc", handle);

module.exports = { render, canUse, PERMISSION };
