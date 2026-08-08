const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

/**
 * Convertit des millisecondes en mm:ss / hh:mm:ss
 */
function formatDuration(seconds) {
  if (!seconds || seconds === Infinity) return "🔴 LIVE";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Construit une barre de progression textuelle simple
 */
function buildProgressBar(current, total, size = 18) {
  if (!total || total === Infinity) return "▬".repeat(size);
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * size);
  return "▬".repeat(filled) + "🔘" + "▬".repeat(Math.max(size - filled, 0));
}

/**
 * Construit le panel "En cours de lecture" en Components V2.
 * @param {import('distube').Queue} queue - la queue DisTube
 * @returns {{ flags: number, components: any[] }}
 */
function buildNowPlayingPanel(queue) {
  const song = queue.songs[0];
  const source =
    song.source === "spotify"
      ? "🟢 Spotify"
      : song.source === "youtube"
      ? "🔴 YouTube"
      : "🎵 " + (song.source || "Source inconnue");

  const container = new ContainerBuilder().setAccentColor(0x1db954);

  // Titre + source
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎶 En cours de lecture\n**[${song.name}](${song.url})**\n${source} • Demandé par <@${song.user?.id ?? queue.textChannel?.guild?.ownerId}>`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  // Barre de progression (position réelle non trackée en live, on affiche la durée totale)
  const bar = buildProgressBar(0, song.duration);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `\`00:00\` ${bar} \`${formatDuration(song.duration)}\``
    )
  );

  // Infos complémentaires
  const nextSong = queue.songs[1];
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `🔊 Volume : **${queue.volume}%**`,
        `🔁 Boucle : **${
          queue.repeatMode === 0
            ? "Désactivée"
            : queue.repeatMode === 1
            ? "Chanson"
            : "File d'attente"
        }**`,
        `📜 File d'attente : **${queue.songs.length - 1}** titre(s)`,
        nextSong ? `⏭️ Suivant : **${nextSong.name}**` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  // Boutons de contrôle (ActionRow classique, compatible Components V2)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_pauseresume")
      .setEmoji(queue.paused ? "▶️" : "⏸️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setEmoji("⏭️")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setEmoji("⏹️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("music_loop")
      .setEmoji("🔁")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_queue")
      .setEmoji("📜")
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

module.exports = { buildNowPlayingPanel, formatDuration };
