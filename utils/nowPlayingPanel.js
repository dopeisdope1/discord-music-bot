const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const LOOP_LABELS = { none: "Désactivée", track: "Chanson", queue: "File d'attente" };

// Icône Spotify (Wikimedia Commons, lien direct stable).
const SPOTIFY_ICON_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Spotify_icon.svg/960px-Spotify_icon.svg.png";

/**
 * Convertit des secondes en mm:ss / hh:mm:ss
 */
function formatDuration(seconds) {
  if (seconds === Infinity) return "LIVE";
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
  if (!total || total === Infinity) return "-".repeat(size);
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * size);
  return "-".repeat(filled) + "o" + "-".repeat(Math.max(size - filled, 0));
}

/**
 * Construit le panel "En cours de lecture" en Components V2, sans couleur
 * d'accent ni emoji. Affiche la pochette du morceau et un badge Spotify.
 * @param {import('kazagumo').KazagumoPlayer} player
 * @param {number} [elapsedMs] - position de lecture actuelle, en millisecondes
 * @returns {{ flags: number, components: any[] }}
 */
function buildNowPlayingPanel(player, elapsedMs = 0) {
  const track = player.queue.current;
  const durationMs = track.length || 0;
  const durationSeconds = Math.floor(durationMs / 1000);
  const elapsedSeconds = Math.min(Math.floor(elapsedMs / 1000), durationSeconds || Infinity);

  const container = new ContainerBuilder();

  // Titre + source, avec la pochette du morceau en vignette
  const titleText = new TextDisplayBuilder().setContent(
    `## En cours de lecture\n**[${track.title}](${track.uri})**\n${
      track.author || "Source inconnue"
    } • Demandé par <@${track.requester?.id ?? ""}>`
  );
  if (track.thumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(titleText)
        .setThumbnailAccessory((thumbnail) => thumbnail.setURL(track.thumbnail))
    );
  } else {
    container.addTextDisplayComponents(titleText);
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  // Barre de progression, mise à jour toutes les 5s (le maximum sans risquer
  // un rate-limit Discord sur l'édition de message), + timestamp Discord natif
  // pour la fin du morceau (défile tout seul côté client, sans coût d'édition).
  const bar = buildProgressBar(elapsedSeconds, durationSeconds);
  const totalLabel = durationSeconds > 0 ? formatDuration(durationSeconds) : "LIVE";
  const statusLine =
    durationMs === 0
      ? null
      : player.paused
      ? "En pause"
      : `Fin <t:${Math.floor((Date.now() + (durationMs - elapsedMs)) / 1000)}:R>`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [`\`${formatDuration(elapsedSeconds)}\` \`${bar}\` \`${totalLabel}\``, statusLine]
        .filter(Boolean)
        .join("\n")
    )
  );

  // Infos complémentaires
  const nextTrack = player.queue[0];
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `Volume : **${player.volume}%**`,
        `Boucle : **${LOOP_LABELS[player.loop] ?? "Désactivée"}**`,
        `File d'attente : **${player.queue.length}** titre(s)`,
        nextTrack ? `Suivant : **${nextTrack.title}**` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  // Badge Spotify (recherche des titres via l'API Spotify)
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent("Recherche de titres via Spotify"))
      .setThumbnailAccessory((thumbnail) => thumbnail.setURL(SPOTIFY_ICON_URL))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  // Boutons de contrôle (ActionRow classique, compatible Components V2)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_pauseresume")
      .setLabel(player.paused ? "Reprendre" : "Pause")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_skip")
      .setLabel("Suivant")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_loop")
      .setLabel("Boucle")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("music_queue")
      .setLabel("File")
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

/**
 * Construit un petit panel Components V2 confirmant l'arrêt de la lecture.
 * Doit rester en Components V2 : le message édité l'était déjà (le flag
 * IS_COMPONENTS_V2 ne peut pas être retiré via une édition).
 */
function buildStoppedPanel() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("**Lecture arrêtée** — file d'attente vidée.")
  );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

module.exports = { buildNowPlayingPanel, buildStoppedPanel, formatDuration, LOOP_LABELS };
