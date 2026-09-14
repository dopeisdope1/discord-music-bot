const { buildStatusEmbed } = require("./statusEmbed");
const { buildStoppedPanel } = require("./nowPlayingPanel");
const { stopNowPlayingTracking } = require("./musicPlayer");
const { SEARCH_ENGINE } = require("./searchEngine");

/**
 * Une piste peut échouer APRÈS avoir "démarré" : la recherche aboutit, le
 * panel s'affiche, puis la lecture jette une erreur — Lavalink répond alors un
 * "Something broke when playing the track" incompréhensible pour la personne
 * qui a juste demandé une chanson. Cas typique : un titre trouvé via Spotify
 * dont l'équivalent reste introuvable sur la source qui fournit réellement le
 * son, ou un lien mémorisé devenu injouable.
 *
 * Ce module regroupe ce qu'on fait dans ces cas-là : relancer le morceau,
 * expliquer clairement s'il n'y a rien à faire, et ne jamais laisser le
 * lecteur muet sur une piste morte.
 */

/** Ce qui identifie une piste, quelle que soit sa provenance. */
const trackKey = (track) => track?.identifier || track?.uri || track?.title || null;

// Un "Suivant" volontaire coupe la piste en cours, et Lavalink signale parfois
// un échec dans la foulée — une résolution interrompue en plein vol en produit
// un. La reprise ne doit surtout pas ressusciter le morceau dans ce cas : la
// personne vient précisément de demander à en sortir.
const MANUAL_SKIP_WINDOW_MS = 8_000;
const manualSkips = new Map();

/** À appeler partout où le bot passe un morceau à la demande de quelqu'un. */
function noteManualSkip(guildId) {
  manualSkips.set(guildId, Date.now());
}

function wasManuallySkipped(guildId) {
  const at = manualSkips.get(guildId);
  return Boolean(at && Date.now() - at < MANUAL_SKIP_WINDOW_MS);
}

/**
 * Message affiché quand une piste refuse de se lire, à la place de la phrase
 * anglaise de Lavalink.
 */
function playbackFailureMessage(deadTrack, error, searchEngine = SEARCH_ENGINE) {
  const cause = error?.exception?.cause || "";
  const detail = error?.exception?.message || error?.message || "";
  const titre = deadTrack?.title ? `**${deadTrack.title}**` : "Ce morceau";
  const source = searchEngine === "soundcloud" ? "SoundCloud" : searchEngine;

  // YouTube a changé le chiffrement de son lecteur et l'extension du nœud est
  // en retard : rien à voir avec le morceau demandé, autant le dire.
  if (/sig function|ScriptExtraction|cipher/i.test(cause))
    return "YouTube a changé son lecteur et le serveur audio doit être mis à jour. Préviens-moi si ça persiste.";

  // Message générique de Lavalink. La cause quasi systématique : le titre
  // n'existe pas sur la source qui fournit le son.
  if (!detail || /Something broke when playing the track/i.test(detail))
    return `${titre} n'a pas pu être lu : introuvable sur ${source}, la source utilisée pour le son.`;

  return `${titre} n'a pas pu être lu : ${String(detail).slice(0, 300)}`;
}

/**
 * @param {import("discord.js").Client} client — porte kazagumo, les salons et
 *   les messages de panel du bot.
 * @param {string} [searchEngine] — source de recherche à utiliser pour relancer.
 */
function createDeadTrackRecovery(client, searchEngine = SEARCH_ENGINE) {
  // Une piste déjà relancée par serveur : sans ce garde-fou, un titre
  // réellement introuvable repartirait en boucle sur lui-même.
  const retried = new Map();

  /** Rejoue le même titre via une recherche "titre + artiste". */
  async function replayByTitle(player, deadTrack) {
    const key = trackKey(deadTrack);
    const query = [deadTrack?.title, deadTrack?.author].filter(Boolean).join(" ");
    if (!key || !query || retried.get(player.guildId) === key) return false;
    retried.set(player.guildId, key);

    const result = await client.kazagumo
      .search(query, { requester: deadTrack.requester, engine: searchEngine })
      .catch(() => null);
    if (!result?.tracks?.length) return false;

    console.log(`[musique] "${query}" relancé via ${searchEngine} après un échec de lecture.`);
    player.queue.current = null;
    const started = await player.play(result.tracks[0]).catch((err) => {
      console.error("[musique] la reprise a échoué elle aussi :", err.message);
      return null;
    });
    return Boolean(started);
  }

  /**
   * Referme le panel "En cours de lecture" quand il ne reste rien à jouer.
   * Sans ça, il restait figé sur un morceau mort, barre de progression à 0:00,
   * comme si la musique tournait toujours.
   */
  function closeNowPlayingPanel(guildId) {
    const panel = client.nowPlayingMessages.get(guildId);
    stopNowPlayingTracking(client, guildId);
    panel?.edit(buildStoppedPanel()).catch(() => {});
  }

  /**
   * Piste morte (échec de lecture ou blocage) : on tente de la relancer, sinon
   * on explique pourquoi et on enchaîne sur la suite — ou on referme le panel
   * s'il n'y a plus rien.
   *
   * `queue.current` est remise à null avant d'enchaîner : Kazagumo l'y laisse,
   * si bien qu'un player.play() nu rejouerait indéfiniment la piste morte.
   */
  async function handleDeadTrack(player, deadTrack, message) {
    // Quelqu'un vient de passer ce morceau : son geste prime, on ne le relance
    // pas et on ne commente pas un échec qu'il a lui-même provoqué.
    if (wasManuallySkipped(player.guildId)) return;

    if (await replayByTitle(player, deadTrack)) return;

    const textChannel = client.channels.cache.get(player.textId);
    if (textChannel && message)
      textChannel.send({ embeds: [buildStatusEmbed("error", message)] }).catch(() => {});

    player.queue.current = null;

    if (!player.queue.size) {
      closeNowPlayingPanel(player.guildId);
      return;
    }

    await player
      .play()
      .catch((err) => console.error("[musique] impossible d'enchaîner :", err.message));
  }

  return { handleDeadTrack, closeNowPlayingPanel, replayByTitle };
}

module.exports = { createDeadTrackRecovery, playbackFailureMessage, noteManualSkip, trackKey };
