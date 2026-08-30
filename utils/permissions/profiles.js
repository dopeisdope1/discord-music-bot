// Profils prédéfinis (section 8 du cahier des charges) : un point de départ
// pratique, pas un lien permanent. Appliquer un profil à un rôle = un octroi
// en masse ponctuel dans utils/permissions/store.js — le résultat reste
// ensuite éditable clé par clé depuis le panel, comme n'importe quel octroi.
const PROFILES = [
  {
    key: "helper",
    label: "Helper",
    description: "Nettoyage de salon uniquement.",
    permissions: ["moderation.clear"],
  },
  {
    key: "moderateur",
    label: "Modérateur",
    description: "Modération courante : nettoyage, expulsion, timeout, salons.",
    permissions: [
      "moderation.clear",
      "moderation.kick",
      "moderation.timeout",
      "channels.lock",
      "channels.slowmode",
      "members.info",
      "logs.view",
    ],
  },
  {
    key: "admin",
    label: "Admin",
    description: "Modération avancée : ban, gestion des rôles/salons, logs.",
    permissions: [
      "moderation.clear",
      "moderation.kick",
      "moderation.ban",
      "moderation.unban",
      "moderation.softban",
      "moderation.timeout",
      "channels.lock",
      "channels.slowmode",
      "channels.manage",
      "channels.lockdown",
      "members.nick",
      "members.role",
      "members.info",
      "logs.view",
      "logs.manage",
    ],
  },
];

const BY_KEY = new Map(PROFILES.map((p) => [p.key, p]));

const getProfile = (key) => BY_KEY.get(key) || null;

module.exports = { PROFILES, getProfile };
