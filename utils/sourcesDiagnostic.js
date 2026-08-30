const { buildStatusEmbed } = require("./statusEmbed");
const { SEARCH_ENGINE } = require("./searchEngine");

/**
 * Dit, source par source, ce que le nœud audio arrive réellement à charger.
 *
 * Sans ça, on en est réduit aux suppositions : Spotify ne fournit AUCUN flux
 * audio, il ne donne que des métadonnées (titre, artiste, pochette). Le son
 * vient forcément d'ailleurs — YouTube ou SoundCloud. Quand un morceau Spotify
 * refuse de se lire, la vraie question est donc "laquelle de ces deux sources
 * répond encore ?", et c'est à ça que répond ce diagnostic.
 *
 * On interroge le nœud directement plutôt que de passer par Kazagumo : sa
 * méthode search() avale les erreurs de chargement et renvoie une liste vide,
 * ce qui confond "aucun résultat" et "source qui nous refuse l'accès" — soit
 * précisément la distinction qu'on cherche à faire ici.
 */

const DEFAULT_QUERY = "daft punk one more time";

/** Résumé lisible d'une réponse brute de Lavalink. */
function summarize(raw) {
  if (!raw) return "aucune réponse du nœud";

  switch (raw.loadType) {
    case "track":
      return `ok — ${raw.data?.info?.title || "titre chargé"}`;
    case "playlist":
      return `ok — playlist « ${raw.data?.info?.name} » (${raw.data?.tracks?.length ?? "?"} titres)`;
    case "search": {
      const premier = raw.data?.[0]?.info;
      return premier ? `ok — ${raw.data.length} résultats, dont « ${premier.title} »` : "aucun résultat";
    }
    case "empty":
      return "aucun résultat";
    case "error":
      return `ÉCHEC — ${raw.data?.message || raw.data?.cause || "cause non précisée"}`;
    default:
      return `réponse inattendue (${raw.loadType})`;
  }
}

/** Les identifiants à tester selon ce qu'on nous donne. */
function buildProbes(query) {
  if (/^https?:\/\//i.test(query)) return [{ label: "Le lien fourni", identifier: query }];

  return [
    { label: "SoundCloud", identifier: `scsearch:${query}` },
    { label: "YouTube", identifier: `ytsearch:${query}` },
    { label: "YouTube Music", identifier: `ytmsearch:${query}` },
  ];
}

/**
 * @returns {Promise<{ lignes: string[], noeud: string|null }>}
 */
async function probeSources(kazagumo, query = DEFAULT_QUERY) {
  const noeuds = [...(kazagumo.shoukaku?.nodes?.values?.() || [])];
  const noeud = noeuds.find((n) => n.state === 1) || noeuds[0];
  if (!noeud) return { lignes: ["Aucun nœud audio n'est connecté."], noeud: null };

  const lignes = [];
  for (const { label, identifier } of buildProbes(query)) {
    const raw = await noeud.rest.resolve(identifier).catch((err) => ({
      loadType: "error",
      data: { message: err?.message },
    }));
    lignes.push(`**${label}** — ${summarize(raw)}`);
  }

  return { lignes, noeud: noeud.name };
}

/**
 * Commande `&sources [titre ou lien]` : réservée aux personnes autorisées,
 * elle sert à savoir d'où le son peut encore venir.
 */
async function handleSourcesDiagnostic(client, message, args) {
  const query = args.join(" ").trim() || DEFAULT_QUERY;
  const attente = await message.reply({
    embeds: [buildStatusEmbed("info", `Test des sources avec « ${query} »...`)],
  });

  const { lignes, noeud } = await probeSources(client.kazagumo, query);

  const entete = noeud ? `Nœud **${noeud}** · source utilisée pour la recherche : **${SEARCH_ENGINE}**` : "";
  const note =
    "\n\nSpotify ne fournit jamais le son, seulement les informations du morceau : " +
    "c'est l'une des sources ci-dessus qui doit le jouer. Un chargement qui aboutit " +
    "ne garantit pas la lecture, mais un échec ici la rend impossible.";

  await attente.edit({
    embeds: [buildStatusEmbed("info", [entete, ...lignes].filter(Boolean).join("\n") + note, { title: "Sources audio" })],
  });
}

module.exports = { handleSourcesDiagnostic, probeSources, summarize, buildProbes, DEFAULT_QUERY };
