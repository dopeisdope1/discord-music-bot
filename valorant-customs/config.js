require("dotenv").config();

// Petit helper : les booléens d'environnement arrivent en chaîne de caractères.
const bool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "oui", "yes", "on"].includes(String(value).toLowerCase());
};
const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

module.exports = {
  token: process.env.DISCORD_TOKEN,
  // L'ID de l'application est de toute façon encodé dans la 1re partie du
  // token : CLIENT_ID reste optionnel (voir deploy-commands.js).
  clientId: process.env.CLIENT_ID || null,

  // Salons / rôles optionnels du serveur.
  logChannelId: process.env.LOG_CHANNEL_ID || null,
  staffRoleId: process.env.STAFF_ROLE_ID || null,
  voiceCategoryId: process.env.VOICE_CATEGORY_ID || null,

  timings: {
    // Cœur du système anti-absent : délai laissé au joueur averti.
    warnMs: int(process.env.WARN_SECONDS, 60) * 1000,
    // Délai laissé au joueur de la liste d'attente pour accepter la place libérée.
    promoteMs: int(process.env.PROMOTE_SECONDS, 60) * 1000,
    // Au-delà, une partie oubliée est purgée du stockage au démarrage.
    matchTtlMs: 12 * 60 * 60 * 1000,
  },

  behaviour: {
    // false = le joueur en attente doit confirmer avec un bouton (demandé par défaut).
    autoPromote: bool(process.env.AUTO_PROMOTE, false),
    // Tant que les salons d'équipe n'existent pas (partie pas encore lancée),
    // être connecté à n'importe quel vocal du serveur suffit pour "répondre présent".
    warnAcceptAnyVoice: bool(process.env.WARN_ACCEPT_ANY_VOICE, true),
  },

  // Palette sombre et sobre, cohérente d'un embed à l'autre.
  colors: {
    base: 0x1b1f27,
    waiting: 0x2b2d31,
    live: 0xff4655, // rouge Valorant : la partie est lancée
    ended: 0x4e5058,
    warn: 0xfaa61a,
    error: 0xed4245,
    success: 0x57f287,
  },

  emojis: {
    team1: "🔴",
    team2: "🔵",
    waitlist: "🕐",
    leave: "🚪",
    start: "▶️",
    end: "🛑",
    warn: "⚠️",
    host: "👑",
    map: "🗺️",
    empty: "➖",
  },

  // Séparateur visuel réutilisé dans tous les embeds.
  separator: "───────────────────────────────",

  // Formats proposés par /custom. `perTeam` = nombre de joueurs par équipe.
  formats: [
    { key: "5v5", label: "5v5", perTeam: 5 },
    { key: "1v1", label: "1v1", perTeam: 1 },
    { key: "2v2", label: "2v2", perTeam: 2 },
    { key: "3v3", label: "3v3", perTeam: 3 },
    { key: "4v4", label: "4v4", perTeam: 4 },
  ],

  // Pool de maps (25 choix max par option slash, on est large).
  maps: [
    "Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture",
    "Haven", "Icebox", "Lotus", "Pearl", "Split", "Sunset",
  ],
};
