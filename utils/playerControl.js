const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Enregistre qui a amené le bot en vocal pour ce serveur (la première fois
 * seulement — un `!play`/`!join` suivant par quelqu'un d'autre pendant que le
 * player existe déjà ne change pas le propriétaire).
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} ownerId
 */
function setPlayerOwner(client, guildId, ownerId) {
  if (!client.playerOwners.has(guildId)) {
    client.playerOwners.set(guildId, ownerId);
  }
}

/**
 * À appeler à chaque `player.destroy()` pour repartir de zéro : le prochain
 * `!play`/`!join` désignera un nouveau propriétaire.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 */
function clearPlayerControl(client, guildId) {
  client.playerOwners.delete(guildId);
  client.playerAllowed.delete(guildId);
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean} true si `userId` peut utiliser les commandes de contrôle
 *   (pause/skip/stop/volume/loop/leave) : soit c'est le propriétaire, soit il
 *   a été autorisé entretemps via une demande acceptée.
 */
function canControlPlayer(client, guildId, userId) {
  const ownerId = client.playerOwners.get(guildId);
  if (!ownerId || ownerId === userId) return true;
  return client.playerAllowed.get(guildId)?.has(userId) ?? false;
}

/**
 * Envoie une demande d'autorisation à la personne qui a amené le bot en
 * vocal, pour que `requester` puisse aussi utiliser les commandes de contrôle
 * sur ce serveur. Si elle accepte, `requester` est autorisé jusqu'à la
 * prochaine fois que le player est détruit (voir clearPlayerControl).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {import('discord.js').User} requester
 * @param {string} guildId
 */
async function requestPlayerAccess(client, channel, requester, guildId) {
  const ownerId = client.playerOwners.get(guildId);
  if (!ownerId) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`player_access:accept:${requester.id}`)
      .setLabel("Accepter")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`player_access:deny:${requester.id}`)
      .setLabel("Refuser")
      .setStyle(ButtonStyle.Secondary)
  );

  const requestMessage = await channel
    .send({
      content: `<@${ownerId}>`,
      embeds: [buildStatusEmbed("info", `**${requester.tag}** veut gérer le bot avec toi, accepter ?`)],
      components: [row],
      allowedMentions: { users: [ownerId] },
    })
    .catch(() => null);
  if (!requestMessage) return;

  const collector = requestMessage.createMessageComponentCollector({ time: REQUEST_TIMEOUT_MS, max: 1 });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== ownerId) {
        await i.reply({
          content: "Seule la personne qui a lancé la musique peut répondre à cette demande.",
          ephemeral: true,
        });
        return;
      }

      const accepted = i.customId.startsWith("player_access:accept:");
      if (accepted) {
        if (!client.playerAllowed.has(guildId)) client.playerAllowed.set(guildId, new Set());
        client.playerAllowed.get(guildId).add(requester.id);
      }

      await i.update({
        embeds: [
          buildStatusEmbed(
            accepted ? "success" : "error",
            accepted
              ? `Accepté — **${requester.tag}** peut maintenant gérer le bot avec toi.`
              : "Refusé."
          ),
        ],
        components: [],
      });
    } catch (err) {
      console.error("[playerControl] Erreur sur une demande d'accès :", err);
    }
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      requestMessage
        .edit({ embeds: [buildStatusEmbed("warning", "Demande expirée.")], components: [] })
        .catch(() => {});
    }
  });
}

/**
 * Équivalent de la vérification faite côté commandes texte, pour les
 * commandes slash (ChatInputCommandInteraction).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>} true si la commande peut continuer
 */
async function requirePlayerControlInteraction(interaction) {
  if (canControlPlayer(interaction.client, interaction.guildId, interaction.user.id)) return true;
  requestPlayerAccess(interaction.client, interaction.channel, interaction.user, interaction.guildId);
  await interaction.reply({
    embeds: [
      buildStatusEmbed(
        "info",
        "Cette commande est réservée à la personne qui a lancé la musique. Une demande d'autorisation lui a été envoyée."
      ),
    ],
    ephemeral: true,
  });
  return false;
}

module.exports = {
  setPlayerOwner,
  clearPlayerControl,
  canControlPlayer,
  requestPlayerAccess,
  requirePlayerControlInteraction,
};
