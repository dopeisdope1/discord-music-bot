/**
 * Vérifie la reprise d'un morceau qui refuse de se lire (utils/deadTrack.js).
 *
 * Ce chemin ne se déclenche qu'en cas de panne réelle : impossible de l'essayer
 * à la main sans casser volontairement une lecture en cours. D'où ces cas
 * joués sur un faux lecteur — c'est ce qui a permis de vérifier qu'un titre
 * introuvable ne repart pas en boucle sur lui-même.
 *
 * Lancement : node scripts/test-deadtrack.js
 */
const assert = require("assert");
const { createDeadTrackRecovery, playbackFailureMessage, noteManualSkip } = require("../utils/deadTrack");

const LAVALINK_FAULT = { exception: { message: "Something broke when playing the track.", cause: "" } };

/** Faux client : uniquement ce que le module utilise réellement. */
function fakeClient({ searchResults = {} } = {}) {
  const envoyes = [];
  const panels = new Map();

  const client = {
    kazagumo: {
      players: new Map(),
      search: async (query) => searchResults[query] || { tracks: [] },
    },
    channels: { cache: new Map([["salon", { send: async (payload) => envoyes.push(payload) }]]) },
    nowPlayingMessages: panels,
    nowPlayingIntervals: new Map(),
    spotifyFollows: new Map(),
  };

  return { client, envoyes, panels };
}

function fakePlayer({ current, suite = [] } = {}) {
  const joues = [];
  const player = {
    guildId: "serveur",
    textId: "salon",
    queue: { current, size: suite.length },
    play: async (track) => {
      joues.push(track || suite.shift() || null);
      player.queue.size = suite.length;
      return player;
    },
  };
  return { player, joues };
}

const PISTE = { identifier: "abc", title: "Balafres", author: "Keeqaid", uri: "https://open.spotify.com/track/abc" };
const texteDe = (payload) => payload.embeds[0].data.description;

let reussis = 0;
function cas(nom, fn) {
  return fn()
    .then(() => {
      reussis++;
      console.log(`  ok — ${nom}`);
    })
    .catch((err) => {
      console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
      process.exitCode = 1;
    });
}

async function main() {
  console.log("Reprise d'un morceau qui ne se lance pas :");

  await cas("le morceau est relancé par une recherche titre + artiste", async () => {
    const alternative = { identifier: "sc-1", title: "Balafres" };
    const { client, envoyes } = fakeClient({ searchResults: { "Balafres Keeqaid": { tracks: [alternative] } } });
    const { handleDeadTrack } = createDeadTrackRecovery(client, "soundcloud");
    const { player, joues } = fakePlayer({ current: PISTE });

    await handleDeadTrack(player, PISTE, "message d'échec");

    assert.deepStrictEqual(joues, [alternative], "l'alternative trouvée doit être jouée");
    assert.strictEqual(envoyes.length, 0, "rien ne doit être annoncé quand la musique repart");
  });

  await cas("sans alternative, la raison est annoncée en français", async () => {
    const { client, envoyes } = fakeClient();
    const { handleDeadTrack } = createDeadTrackRecovery(client, "soundcloud");
    const { player, joues } = fakePlayer({ current: PISTE });

    await handleDeadTrack(player, PISTE, playbackFailureMessage(PISTE, LAVALINK_FAULT, "soundcloud"));

    assert.strictEqual(joues.length, 0, "rien ne doit être joué");
    assert.strictEqual(envoyes.length, 1, "un message doit expliquer l'échec");
    assert.match(texteDe(envoyes[0]), /Balafres.*introuvable sur SoundCloud/s);
  });

  await cas("le panel figé est refermé quand il ne reste rien", async () => {
    const { client, panels } = fakeClient();
    let panelEdite = null;
    panels.set("serveur", { edit: async (payload) => (panelEdite = payload) });
    const { handleDeadTrack } = createDeadTrackRecovery(client, "soundcloud");
    const { player } = fakePlayer({ current: PISTE });

    await handleDeadTrack(player, PISTE, "message d'échec");

    assert.ok(panelEdite, "le panel doit être réécrit");
    assert.match(JSON.stringify(panelEdite), /Lecture arrêtée/);
    assert.strictEqual(panels.has("serveur"), false, "le suivi du panel doit être nettoyé");
  });

  await cas("la file continue quand un morceau meurt au milieu", async () => {
    const suivant = { identifier: "suivant", title: "Suivant" };
    const { client } = fakeClient();
    const { handleDeadTrack } = createDeadTrackRecovery(client, "soundcloud");
    const { player, joues } = fakePlayer({ current: PISTE, suite: [suivant] });

    await handleDeadTrack(player, PISTE, "message d'échec");

    assert.strictEqual(player.queue.current, null, "la piste morte doit être retirée");
    assert.deepStrictEqual(joues, [suivant], "le morceau suivant doit démarrer");
  });

  await cas("un titre introuvable ne repart pas en boucle", async () => {
    const { client, envoyes } = fakeClient();
    let recherches = 0;
    client.kazagumo.search = async () => {
      recherches++;
      return { tracks: [] };
    };
    const { handleDeadTrack } = createDeadTrackRecovery(client, "soundcloud");

    for (let i = 0; i < 3; i++) {
      const { player } = fakePlayer({ current: PISTE });
      await handleDeadTrack(player, PISTE, "message d'échec");
    }

    assert.strictEqual(recherches, 1, "une seule tentative de reprise pour la même piste");
    assert.strictEqual(envoyes.length, 3, "chaque échec reste annoncé");
  });

  await cas("un « Suivant » volontaire ne ressuscite pas le morceau passé", async () => {
    // Couper une piste en pleine résolution fait remonter un échec à Lavalink :
    // sans ce garde-fou, la reprise relancerait le morceau que la personne
    // vient justement de passer.
    const alternative = { identifier: "sc-1", title: "Balafres" };
    const { client, envoyes } = fakeClient({ searchResults: { "Balafres Keeqaid": { tracks: [alternative] } } });
    const { handleDeadTrack } = createDeadTrackRecovery(client, "soundcloud");
    const { player, joues } = fakePlayer({ current: PISTE });

    noteManualSkip(player.guildId);
    await handleDeadTrack(player, PISTE, "message d'échec");

    assert.strictEqual(joues.length, 0, "rien ne doit être relancé");
    assert.strictEqual(envoyes.length, 0, "et rien ne doit être annoncé");
  });

  console.log("\nMessages d'erreur :");

  await cas("le message anglais de Lavalink est traduit et expliqué", async () => {
    const message = playbackFailureMessage(PISTE, LAVALINK_FAULT, "soundcloud");
    assert.doesNotMatch(message, /Something broke/, "plus aucune phrase anglaise de Lavalink");
    assert.match(message, /introuvable sur SoundCloud/);
  });

  await cas("le cas du lecteur YouTube périmé reste distingué", async () => {
    const message = playbackFailureMessage(PISTE, { exception: { message: "x", cause: "Must find sig function" } });
    assert.match(message, /YouTube a changé son lecteur/);
  });

  await cas("un détail précis de Lavalink est conservé", async () => {
    const message = playbackFailureMessage(PISTE, { exception: { message: "This video is age restricted", cause: "" } });
    assert.match(message, /age restricted/);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
}

main();
