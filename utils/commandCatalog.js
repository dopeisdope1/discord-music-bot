// Catalogue unique des commandes du bot, partagé par &help et &panel pour
// qu'ils ne puissent pas se contredire. `scope` indique ce qu'il faut pour
// utiliser la commande :
//   null    -> tout le monde
//   "salon" -> autorisé via &salonperm (ou sys, ou propriétaire)
//   "sys"   -> rang sys accordé par &zinki (ou propriétaire)
//   "owner" -> propriétaire du bot uniquement
// `prefix` vaut "main" (préfixe musique) ou "mod" (préfixe &).
// La musique est volontairement absente de ce catalogue : elle vit sur son
// propre préfixe, rappelé en pied de l'aide, et l'encombrait inutilement.
const CATEGORIES = [
  {
    key: "public",
    label: "Public",
    commands: [
      { name: "pic [@membre]", prefix: "mod", scope: null, description: "Affiche l'avatar d'un membre" },
      { name: "banner [@membre]", prefix: "mod", scope: null, description: "Affiche la bannière d'un membre" },
      { name: "server", prefix: "mod", scope: null, description: "Affiche les informations du serveur" },
      { name: "snipe", prefix: "mod", scope: null, description: "Affiche le dernier message supprimé du salon" },
    ],
  },
  {
    key: "moderation",
    label: "Modération",
    commands: [
      // Les trois déclencheurs font strictement la même chose : une seule
      // entrée plutôt que trois lignes identiques.
      {
        name: "uo clear",
        prefix: null,
        scope: null,
        description: "Sans préfixe, efface tes propres messages du salon. Variantes : `anas clear`, `yanis clear`",
      },
      { name: "lock", prefix: "mod", scope: "salon", description: "Empêche @everyone d'écrire dans le salon" },
      { name: "unlock", prefix: "mod", scope: "salon", description: "Rétablit l'écriture" },
      { name: "hide", prefix: "mod", scope: "salon", description: "Masque le salon à @everyone" },
      { name: "unhide", prefix: "mod", scope: "salon", description: "Réaffiche le salon" },
      { name: "renew", prefix: "mod", scope: "salon", description: "Recrée le salon à neuf (l'historique est perdu)" },
      {
        name: "zinki assasini [@membre] [raison]",
        prefix: null,
        scope: "sys",
        description: "Sans préfixe, ouvre le panneau de bannissement (confirmation obligatoire)",
      },
    ],
  },
  {
    key: "admin",
    label: "Administration",
    commands: [
      // Tout se règle depuis le panneau : dispenses, accès aux salons,
      // préfixes, et le rang sys pour le propriétaire seul.
      { name: "panel", prefix: "mod", scope: "sys", description: "Panneau de configuration" },
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
