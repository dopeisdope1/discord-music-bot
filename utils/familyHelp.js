const {
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const { CATEGORIES } = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");
const { rendreEnCache, resumer, enTexte } = require("./dashboardImage");
const { identityOf } = require("./helpPanel");

// Taper `&giveaway` tout seul ne répondait RIEN : le dispatcher ne reconnaît
// que `giveaway start` et `giveaway reroll`, et sortait en silence sur tout le
// reste. Il fallait donc ouvrir &help, choisir la bonne rubrique et y chercher
// la commande — pour une information que la commande elle-même connaît.
//
// Ce module répond à la place : les variantes réellement disponibles, avec
// leur syntaxe exacte, filtrées sur les droits de la personne.
const NOM_IMAGE = "commandes.png";
const COULEUR = "#d0d0d0";
const MAX_PROCHES = 6;

/**
 * Toutes les commandes du catalogue réellement câblées ET accessibles, avec
 * le thème d'où elles viennent — il sert à écarter les faux voisins.
 */
function commandesAccessibles(member) {
  const accessibles = [];
  for (const categorie of CATEGORIES) {
    for (const cmd of categorie.commands) {
      if (!isImplemented(cmd)) continue;
      if (!can(member, cmd.permission)) continue;
      accessibles.push({ cmd, theme: categorie.key });
    }
  }
  return accessibles;
}

/** Le vrai préfixe d'une commande — toutes ne vivent pas sur le même. */
function prefixePour(cmd, prefixes) {
  if (!cmd.prefix) return "";
  return cmd.prefix === "main" ? prefixes.main : prefixes.musicMod;
}

/**
 * Une commande peut-elle tourner telle quelle, sans rien après ? La syntaxe du
 * catalogue le dit : `< >` marque un argument OBLIGATOIRE, `[ ]` un argument
 * facultatif. `&stats` tourne seule, `&ban <@membre|id>` non.
 */
function tourneSeule(cmd) {
  return !/[<]/.test(cmd.name);
}

/**
 * Les commandes à rappeler quand `mot` est tapé seul.
 * @returns {{variantes: object[], proches: object[]}} `variantes` = même
 *   premier mot (`giveaway start`, `giveaway reroll`) ; `proches` = les
 *   commandes dont le nom contient le mot sans commencer par lui (`unban`,
 *   `tempban`, `banall` pour « ban »), que l'on cherche justement quand on ne
 *   se souvient plus du nom exact.
 */
function famillesDe(mot, member) {
  const accessibles = commandesAccessibles(member);
  const variantes = [];
  const candidates = [];
  const vues = new Set();
  const themesDeLaFamille = new Set();
  for (const { cmd, theme } of accessibles) {
    const identite = identityOf(cmd);
    if (vues.has(identite)) continue;
    const premierMot = identite.split(" ")[0];
    if (premierMot === mot) {
      vues.add(identite);
      themesDeLaFamille.add(theme);
      variantes.push(cmd);
    } else if (premierMot.includes(mot)) {
      vues.add(identite);
      candidates.push({ cmd, theme });
    }
  }
  // Une voisine doit venir du MÊME thème que la commande tapée. Sans cette
  // condition, `&ban` proposait `&banner` (« affiche la bannière d'un
  // membre ») : le mot s'y trouve, mais la commande n'a rien à voir et
  // brouille une liste qui doit se lire d'un coup d'œil.
  const proches = candidates.filter((c) => themesDeLaFamille.has(c.theme)).map((c) => c.cmd);
  return { variantes, proches };
}

const enItem = (cmd, prefixes) => ({
  nom: `${prefixePour(cmd, prefixes)}${cmd.name}`,
  description: resumer(cmd.description),
});

/**
 * La carte de rappel d'une commande tapée seule, ou `null` s'il n'y a rien à
 * rappeler — auquel cas l'appelant poursuit son chemin normal.
 *
 * Renvoie `null` dans deux cas, et c'est ce qui évite de parasiter les
 * commandes qui marchent :
 *   - la commande tourne très bien sans argument (`&stats`, `&banlist`) ;
 *   - une seule variante, sans argument obligatoire ni voisine à signaler.
 *
 * @param {string} mot le mot tapé, en minuscules, sans préfixe
 * @param {import('discord.js').GuildMember} member
 * @param {string} guildId
 * @param {{sansImage?: boolean}} [options]
 */
function buildFamilyCard(mot, member, guildId, { sansImage = false } = {}) {
  const { variantes, proches } = famillesDe(mot, member);
  if (!variantes.length) return null;
  // Elle sait tourner seule : c'est à elle de répondre, pas à un rappel.
  if (variantes.some((cmd) => identityOf(cmd) === mot && tourneSeule(cmd))) return null;
  if (variantes.length === 1 && !proches.length && tourneSeule(variantes[0])) return null;

  const prefixes = getPrefixes(guildId);
  const prefixe = prefixePour(variantes[0], prefixes) || prefixes.musicMod;
  const cartes = [
    {
      titre: `${prefixe}${mot}`,
      sousTitre: variantes.length > 1 ? "Les variantes disponibles" : "La syntaxe attendue",
      couleur: COULEUR,
      items: variantes.map((cmd) => enItem(cmd, prefixes)),
    },
  ];
  if (proches.length) {
    cartes.push({
      titre: "Commandes proches",
      sousTitre: `Elles portent aussi « ${mot} » dans leur nom`,
      couleur: COULEUR,
      // Bornées : « role » en ramène une douzaine (muterole, antirole,
      // antiroledelete...) qui feraient une carte plus longue que la vue
      // complète de &help, pour une simple piste.
      items: proches.slice(0, MAX_PROCHES).map((cmd) => enItem(cmd, prefixes)),
    });
  }

  const spec = {
    titre: `${prefixe}${mot}`,
    sousTitre: `Préfixe : ${prefixes.musicMod} · [ ] facultatif, < > obligatoire`,
    cartes,
    // Une seule colonne : ces cartes ont peu de lignes mais des syntaxes
    // longues, que deux demi-colonnes tronqueraient en plein milieu.
    colonnes: 1,
    hauteursLibres: true,
    pied: `${prefixes.musicMod}help pour tout voir`,
  };

  const png = sansImage ? null : rendreEnCache(spec);
  const container = new ContainerBuilder();
  if (png) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${NOM_IMAGE}`))
    );
  } else {
    // Même repli que &help : un dessin raté ne doit pas rendre la commande
    // muette, c'est précisément le silence qu'on cherchait à supprimer.
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(enTexte(spec)));
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    ...(png ? { files: [new AttachmentBuilder(png, { name: NOM_IMAGE })] } : {}),
  };
}

module.exports = { buildFamilyCard, famillesDe, tourneSeule };
