/**
 * Salons vocaux d'équipe : création privée, synchronisation des permissions,
 * déplacement automatique, et surtout la vérification de présence utilisée par
 * le système anti-absent.
 */

const { ChannelType, PermissionFlagsBits } = require("discord.js");
const config = require("../config");

const TEAM_CHANNEL_NAMES = { 1: "🔴 Équipe 1", 2: "🔵 Équipe 2" };

const getTeamChannelId = (match, teamNo) => match.voice?.[teamNo] || null;

/** Récupère le membre sans exploser si l'utilisateur a quitté le serveur. */
async function fetchMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

/**
 * Le joueur « répond-il présent » ?
 *
 * - Si le salon de son équipe existe : il doit être DEDANS.
 * - Sinon (partie pas encore lancée) : selon la config, être connecté à
 *   n'importe quel vocal du serveur suffit — inutile de sanctionner un joueur
 *   présent alors que les salons n'existent pas encore.
 */
async function isInTeamVoice(guild, match, teamNo, userId) {
  const member = await fetchMember(guild, userId);
  const channelId = member?.voice?.channelId;
  if (!channelId) return false;

  const teamChannelId = getTeamChannelId(match, teamNo);
  if (teamChannelId) return channelId === teamChannelId;
  return config.behaviour.warnAcceptAnyVoice;
}

/** Overwrites d'un salon d'équipe : personne n'entre sauf les joueurs concernés. */
function buildOverwrites(guild, match, teamNo) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.Stream],
      allow: [PermissionFlagsBits.ViewChannel], // visible mais verrouillé
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers,
      ],
    },
  ];

  // L'hôte et le staff gardent l'accès pour arbitrer. Le Set évite un doublon
  // d'overwrite si l'hôte joue lui-même dans l'équipe (Discord le refuserait).
  const memberIds = new Set([...match.teams[teamNo], match.hostId]);
  if (config.staffRoleId && guild.roles.cache.has(config.staffRoleId)) {
    overwrites.push({
      id: config.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers],
    });
  }

  for (const userId of memberIds) {
    overwrites.push({
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,
      ],
    });
  }

  return overwrites;
}

/**
 * Crée les deux salons vocaux privés de la partie.
 * @returns {Promise<{created: number[], error: string|null}>}
 */
async function createTeamChannels(guild, match, parentIdFallback) {
  const parent = config.voiceCategoryId || parentIdFallback || null;
  const created = [];

  for (const teamNo of [1, 2]) {
    if (match.voice[teamNo]) continue; // déjà créé (relance de la partie)
    try {
      const channel = await guild.channels.create({
        name: `${TEAM_CHANNEL_NAMES[teamNo]} · #${match.id}`,
        type: ChannelType.GuildVoice,
        parent,
        userLimit: match.format.perTeam,
        permissionOverwrites: buildOverwrites(guild, match, teamNo),
        reason: `Partie personnalisée #${match.id} — équipe ${teamNo}`,
      });
      match.voice[teamNo] = channel.id;
      created.push(teamNo);
    } catch (error) {
      return { created, error: error.message };
    }
  }

  return { created, error: null };
}

/** Recalcule les accès d'un salon après un changement d'effectif. */
async function syncTeamPermissions(guild, match, teamNo) {
  const channelId = getTeamChannelId(match, teamNo);
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (channel) await channel.permissionOverwrites.set(buildOverwrites(guild, match, teamNo));
  } catch (error) {
    console.error(`[voice] Sync des permissions impossible (#${match.id}, équipe ${teamNo}) :`, error.message);
  }
}

/**
 * Déplace un joueur dans le salon de son équipe s'il est déjà en vocal.
 * @returns {Promise<{moved: boolean, reason?: string}>}
 */
async function moveToTeamChannel(guild, match, teamNo, userId) {
  const channelId = getTeamChannelId(match, teamNo);
  if (!channelId) return { moved: false, reason: "Le salon vocal de cette équipe n'existe pas encore." };

  const member = await fetchMember(guild, userId);
  if (!member) return { moved: false, reason: "Ce membre n'est plus sur le serveur." };
  if (!member.voice?.channelId) return { moved: false, reason: "Ce joueur n'est connecté à aucun salon vocal." };
  if (member.voice.channelId === channelId) return { moved: false, reason: "Ce joueur est déjà dans le bon salon." };

  try {
    await member.voice.setChannel(channelId, `Partie personnalisée #${match.id}`);
    return { moved: true };
  } catch (error) {
    return { moved: false, reason: `Déplacement refusé par Discord : ${error.message}` };
  }
}

/** Supprime les salons d'équipe (fin de partie). */
async function deleteTeamChannels(client, match) {
  for (const teamNo of [1, 2]) {
    const channelId = match.voice?.[teamNo];
    if (!channelId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      await channel?.delete(`Fin de la partie personnalisée #${match.id}`);
    } catch (error) {
      console.error(`[voice] Suppression du salon équipe ${teamNo} impossible :`, error.message);
    }
    match.voice[teamNo] = null;
  }
}

module.exports = {
  TEAM_CHANNEL_NAMES,
  getTeamChannelId, isInTeamVoice, fetchMember,
  createTeamChannels, syncTeamPermissions, moveToTeamChannel, deleteTeamChannels,
};
