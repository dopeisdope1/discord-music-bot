// Source de recherche unique pour TOUT le bot. Elle était auparavant écrite
// en dur ("youtube") dans trois fichiers, si bien que changer la valeur par
// défaut de Kazagumo ne changeait rien : les appels passaient outre.
//
// SoundCloud par défaut car YouTube refuse les requêtes venant d'un
// hébergeur ("Sign in to confirm you're not a bot") — voir
// lavalink/application.yml. Modifiable sans toucher au code via la variable
// MUSIC_SEARCH_ENGINE, pour repasser à "youtube" le jour où un PoToken est
// fourni au nœud.
const SEARCH_ENGINE = process.env.MUSIC_SEARCH_ENGINE || "soundcloud";

module.exports = { SEARCH_ENGINE };
