const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");

const PANEL_TIMEOUT_MS = 60_000;

function buildZinkiAssassiniPanel() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Zinki Assassini\n> Choisis qui bannir du serveur.")
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("zinki_assassini_select").setPlaceholder("Choisir un membre à bannir")
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Ouvre le panel "Zinki Assassini" (`-ban`, réservé aux administrateurs — la
 * vérification se fait avant l'appel de cette fonction).
 * @param {import('discord.js').Message} message
 */
async function handleBanPanel(message) {
  if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    return;
  }

  const panelMessage = await message.reply(buildZinkiAssassiniPanel());
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS, max: 1 });

  collector.on("collect", async (i) => {
    if (i.user.id !== message.author.id) {
      await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
      return;
    }

    const targetId = i.values[0];

    if (targetId === message.author.id) {
      await i.update({
        embeds: [buildStatusEmbed("error", "Tu ne peux pas te bannir toi-même.")],
        components: [],
      });
      return;
    }

    if (targetId === message.client.user.id) {
      await i.update({
        embeds: [buildStatusEmbed("error", "Je ne vais pas me bannir moi-même.")],
        components: [],
      });
      return;
    }

    // Accuse réception tout de suite (dans les 3s imposées par Discord) : le
    // fetch du membre + le ban lui-même sont de vraies requêtes réseau qui
    // peuvent facilement dépasser ce délai, d'où le "n'a pas répondu à temps".
    await i.deferUpdate();

    const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
    if (targetMember && !targetMember.bannable) {
      await i.editReply({
        embeds: [buildStatusEmbed("error", "Je ne peux pas bannir ce membre (rôle trop élevé ou permissions insuffisantes).")],
        components: [],
      });
      return;
    }

    const banResult = await message.guild.members
      .ban(targetId, { reason: `Zinki Assassini — banni par ${message.author.tag}` })
      .catch((err) => {
        console.error(err);
        return null;
      });

    if (!banResult) {
      await i.editReply({
        embeds: [
          buildStatusEmbed(
            "error",
            `Impossible de bannir ${targetMember ? targetMember.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`
          ),
        ],
        components: [],
      });
      return;
    }

    await i.editReply({
      embeds: [
        buildStatusEmbed("success", `${targetMember ? targetMember.user.tag : `<@${targetId}>`} a été banni.`, {
          title: "Zinki Assassini",
        }),
      ],
      components: [],
    });
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      panelMessage.edit({ components: [] }).catch(() => {});
    }
  });
}

module.exports = { handleBanPanel };
