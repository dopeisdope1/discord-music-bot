// Catalogue unique des commandes du bot, partagé par &help et &panel pour
// qu'ils ne puissent pas se contredire. `scope` indique ce qu'il faut pour
// utiliser la commande :
//   null    -> tout le monde
//   "salon" -> autorisé via &salonperm (ou sys, ou propriétaire)
//   "sys"   -> rang sys accordé par &zinki (ou propriétaire)
//   "owner" -> propriétaire du bot uniquement
// `prefix` vaut "main" (préfixe musique) ou "mod" (préfixe &).
const CATEGORIES = [
  {
    key: "musique",
    label: "Musique",
    commands: [
      { name: "play <titre | lien>", prefix: "main", scope: null, description: "Joue un titre, un lien YouTube/Spotify ou une playlist publique" },
      { name: "play", prefix: "main", scope: null, description: "Sans titre : ouvre ta playlist de favoris" },
      { name: "join [@membre]", prefix: "main", scope: null, description: "Suit en direct ce que tu écoutes sur Spotify" },
      { name: "queue", prefix: "main", scope: null, description: "Affiche la file d'attente" },
      { name: "skip", prefix: "main", scope: null, description: "Passe au titre suivant" },
      { name: "pause", prefix: "main", scope: null, description: "Met la lecture en pause" },
      { name: "resume", prefix: "main", scope: null, description: "Reprend la lecture" },
      { name: "volume <0-150>", prefix: "main", scope: null, description: "Règle le volume" },
      { name: "loop off|song|queue", prefix: "main", scope: null, description: "Change le mode de répétition" },
      { name: "stop", prefix: "main", scope: null, description: "Arrête tout et vide la file" },
      { name: "leave", prefix: "main", scope: null, description: "Fait quitter le vocal au bot" },
    ],
  },
  {
    key: "favoris",
    label: "Favoris",
    commands: [
      { name: "play", prefix: "main", scope: null, description: "Sans titre : ta playlist, avec un menu pour lancer un titre" },
      { name: "Bouton « Favori »", prefix: null, scope: null, description: "Sur le panel de lecture : met le titre en cours dans tes favoris" },
      { name: "Bouton « Mes favoris »", prefix: null, scope: null, description: "Ouvre ta playlist depuis le panel de lecture" },
    ],
  },
  {
    key: "clear",
    label: "Nettoyage",
    commands: [
      { name: "uo clear", prefix: null, scope: null, description: "Sans préfixe : efface tes propres messages du salon" },
      { name: "anas clear", prefix: null, scope: null, description: "Identique à uo clear" },
      { name: "yanis clear", prefix: null, scope: null, description: "Identique à uo clear" },
    ],
  },
  {
    key: "salon",
    label: "Salon",
    commands: [
      { name: "lock", prefix: "mod", scope: "salon", description: "Empêche @everyone d'écrire dans le salon" },
      { name: "unlock", prefix: "mod", scope: "salon", description: "Rétablit l'écriture" },
      { name: "hide", prefix: "mod", scope: "salon", description: "Masque le salon à @everyone" },
      { name: "unhide", prefix: "mod", scope: "salon", description: "Réaffiche le salon" },
      { name: "renew", prefix: "mod", scope: "salon", description: "Recrée le salon à neuf (l'historique est perdu)" },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    commands: [
      { name: "panel", prefix: "mod", scope: "sys", description: "Panneau de configuration" },
      { name: "clearbypass add|remove|list", prefix: "mod", scope: "sys", description: "Dispense du quota de nettoyage" },
      { name: "salonperm add|remove|list", prefix: "mod", scope: "sys", description: "Donne accès aux commandes de salon" },
      { name: "zinki @membre", prefix: "mod", scope: "owner", description: "Donne le rang sys : accès à tout le bot" },
    ],
  },
];

/**
 * Catégories réellement utilisables par quelqu'un, commandes filtrées selon
 * ses droits. Une catégorie dont rien n'est accessible n'apparaît pas.
 * @param {(scope: string|null) => boolean} canUse
 */
function categoriesFor(canUse) {
  return CATEGORIES.map((category) => ({
    ...category,
    commands: category.commands.filter((cmd) => canUse(cmd.scope)),
  })).filter((category) => category.commands.length > 0);
}

module.exports = { CATEGORIES, categoriesFor };
