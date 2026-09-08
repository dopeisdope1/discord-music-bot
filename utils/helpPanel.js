const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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

// Couleur d'accent PARTAGÉE avec &panel (utils/configPanel.js) — même
// identité visuelle pour les deux "pages" du même système, demande
// explicite ("Centre de commandes" / "Centre de gestion").
const ACCENT_COLOR = 0x2c2f5c;

const SELECT_ID = "help_tier";
const PAGE_SELECT_ID = "help_page";

// Le tableau de bord est rendu en image (voir utils/dashboardImage.js) et
// affiché DANS le Container Components V2. Le nom du fichier est fixe : il
// est référencé par "attachment://" dans le composant MediaGallery.
const NOM_IMAGE = "centre-de-commandes.png";

// Plus AUCUNE couleur : demande explicite, sur &help comme sur &panel. Une
// seule teinte neutre sert de gris de tracé pour les liserés et les titres,
// de sorte que le rendu reste lisible sans rien colorer. Le palier d'une
// commande reste indiqué par son libellé de colonne, plus par une teinte.
const COULEUR_PAR_DEFAUT = "#d0d0d0";
const TIER_COLORS = new Proxy({}, { get: () => COULEUR_PAR_DEFAUT });

// Les trois PALIERS de l'ancien &help, réintroduits comme colonnes de la
// grille : c'est ce qui donne du sens aux 3 colonnes (avant, elles étaient
// un simple découpage en trois paquets égaux). Le palier se déduit du droit
// exigé, il n'est jamais saisi à la main :
//   pas de permission  -> tout le monde
//   permission "sys"   -> réservé au rang sys
//   toute autre clé    -> accordable par rôle depuis &panel
const PALIERS = [
  { cle: "public", titre: "Publiques", couleur: COULEUR_PAR_DEFAUT },
  { cle: "configurable", titre: "Configurables", couleur: COULEUR_PAR_DEFAUT },
  { cle: "sys", titre: "Sys", couleur: COULEUR_PAR_DEFAUT },
];
function palierDe(cmd) {
  if (!cmd.permission) return "public";
  return cmd.permission === "sys" ? "sys" : "configurable";
}

// Commandes par colonne, et colonnes par page, dans une catégorie ouverte.
const PAR_COLONNE = 9;
const COLONNES_PAR_PAGE = 2;

/**
 * Le vrai préfixe d'une commande. Toutes ne vivent pas sur le même :
 * `prefix: "mod"` = préfixe des commandes (`&`), `"main"` = préfixe musique,
 * et `null` = déclencheur SANS préfixe (ex. `uo clear`). Afficher `&` devant
 * ce dernier annoncerait une commande qui n'existe pas.
 */
function prefixePour(cmd, prefixes) {
  if (!cmd.prefix) return "";
  return cmd.prefix === "main" ? prefixes.main : prefixes.musicMod;
}

/**
 * Ligne d'identité de l'image. Une image ne sait pas résoudre une mention
 * Discord (`<@id>` s'afficherait littéralement) : on prend donc le pseudo
 * réellement affiché quand on l'a, et on retombe sur l'identifiant sinon —
 * jamais un pseudo inventé.
 */
function identiteAffichee(member, authorId) {
  return member?.displayName || member?.user?.username || member?.user?.tag || `Membre ${authorId}`;
}

// Confirmé en prod via le vrai message d'erreur Discord (avant, avalé
// silencieusement par un .catch vide — la vraie cause n'était pas celle
// devinée au premier passage) :
//   DiscordAPIError[50035] data.components[COMPONENT_DISPLAYABLE_TEXT_SIZE_EXCEEDED]:
//   Components displayable text size exceeds maximum size of 4000
// Ce n'est PAS une limite par composant (chaque TextDisplay peut déjà aller
// jusqu'à 4000) mais le TOTAL du texte affichable de TOUS les composants du
// message CUMULÉ. D'où : un seul bloc de commandes par page (pas deux), et
// chunkBlocks vise plus bas que 4000 pour laisser de la place au titre/à la
// légende qui partagent le même budget.
const MAX_CHUNKS_PER_PAGE = 1;

/**
 * Identité d'affichage d'une commande : tous les mots de TÊTE qui sont de
 * vrais mots du déclencheur (pas un argument) — même logique que
 * utils/implementedCommands.js::isImplemented. Sans ça, "role create",
 * "role delete", "role rename"... fusionnaient tous sous le seul mot
 * ambigu "role".
 * @param {{ name: string, prefix?: string }} cmd
 */
function leadingWords(cmd) {
  if (!cmd.prefix) return [cmd.name];
  const words = cmd.name.trim().split(/\s+/);
  const lead = [];
  for (const w of words) {
    if (/^[a-z]+$/i.test(w)) lead.push(w.toLowerCase());
    else break;
  }
  return lead.length ? lead : [words[0]];
}
const identityOf = (cmd) => leadingWords(cmd).join(" ");

// Regroupement par THÈME (Modération/Sécurité/Rôles & Membres/...) — demande
// explicite de l'utilisateur, à la place de l'ancien tri par palier de
// permission (public/configurable/sys), qui mélangeait des commandes sans
// rapport dans le même palier "configurable". Les thèmes eux-mêmes sont
// définis une seule fois dans utils/commandCatalog.js, jamais recopiés ici.
const TIER_ORDER = CATEGORIES.map((c) => c.key);
const TIER_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
const TIER_EMOJI = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.emoji]));
const TIER_DESCRIPTIONS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.description]));

/**
 * Réduit une liste d'entrées du catalogue à des IDENTITÉS distinctes, en
 * gardant la commande représentative (syntaxe + description) et les alias
 * de chacune. `identityOf` (pas le premier mot brut) garantit que des
 * sous-commandes différentes ("role create" / "role delete") restent deux
 * entrées séparées au lieu de se confondre sous "role".
 * @returns {{ cmd: object, aliases: string[] }[]}
 */
function dedupeByIdentity(commands) {
  const byIdentity = new Map();
  for (const cmd of commands) {
    const id = identityOf(cmd);
    if (!byIdentity.has(id)) byIdentity.set(id, { cmd, aliases: new Set() });
    for (const a of cmd.aliases || []) byIdentity.get(id).aliases.add(a);
  }
  return [...byIdentity.values()].map(({ cmd, aliases }) => ({ cmd, aliases: [...aliases] }));
}

/**
 * Une commande, en bloc : nom (+alias) en gras, description, puis la syntaxe
 * réelle à taper. Un 🔒 discret signale une commande qui exige un droit
 * particulier — pas la clé technique exacte, juste le signal qu'elle est
 * restreinte (l'accès réel reste filtré en amont, ce n'est qu'un repère
 * visuel pour les commandes déjà accordées à cette personne).
 */
function formatCommandBlock(entry, prefixSymbol) {
  const heading = entry.aliases.length ? `${identityOf(entry.cmd)}/${entry.aliases.join("/")}` : identityOf(entry.cmd);
  const lock = entry.cmd.permission ? " 🔒" : "";
  return `🔹 **${heading}**${lock} — ${entry.cmd.description}\n└ \`${prefixSymbol}${entry.cmd.name}\``;
}

/**
 * Répartit des blocs de texte en chunks — un par PAGE (voir
 * MAX_CHUNKS_PER_PAGE), jamais plusieurs dans le même message, puisque la
 * limite de 4000 caractères de Discord porte sur le TOTAL affichable du
 * message, titre+légende compris, pas sur chaque composant pris à part.
 * maxLen reste sous 4000 avec de la marge pour ce titre+légende. La coupe se
 * fait toujours ENTRE deux commandes, jamais au milieu de l'une d'elles.
 */
function chunkBlocks(blocks, maxLen = 3600) {
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const block of blocks) {
    const addedLen = block.length + 2; // +2 pour le "\n\n" de séparation
    if (current.length && currentLen + addedLen > maxLen) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += addedLen;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

// Différé, pas en tête de fichier : utils/configPanel.js require
// utils/permsCommands.js qui require ici — un require en tête fermerait la
// boucle et renverrait un module vide (même piège que celui documenté dans
// utils/implementedCommands.js pour musicCommands.js).
let hasAnyPanelAccessCache = null;
function hasAnyPanelAccessLazy(member) {
  if (!hasAnyPanelAccessCache) hasAnyPanelAccessCache = require("./configPanel").hasAnyPanelAccess;
  return hasAnyPanelAccessCache(member);
}

/**
 * Toutes les commandes IMPLÉMENTÉES du catalogue auxquelles `member` a
 * accès, groupées par THÈME (utils/commandCatalog.js::CATEGORIES). Les
 * commandes seulement documentées (sans backend) ne sont jamais incluses.
 * @returns {Record<string, object[]>} une entrée par clé de CATEGORIES
 */
function groupByTier(member) {
  const canUse = (permission) => can(member, permission);
  const groups = Object.fromEntries(TIER_ORDER.map((key) => [key, []]));
  for (const category of CATEGORIES) {
    for (const cmd of category.commands) {
      if (!isImplemented(cmd)) continue;
      // &panel n'est gardée par AUCUNE clé unique du catalogue — la vraie
      // commande vérifie hasAnyPanelAccess (n'importe quelle permission de
      // rubrique du panel). Sans ce cas particulier, &help l'annonçait
      // "accessible" même à un membre sans aucun droit, pour qui la commande
      // ne fait pourtant rien. Elle vit dans la catégorie "Bot & Accès" du
      // catalogue, comme n'importe quelle autre commande de ce thème.
      if (identityOf(cmd) === "panel") {
        if (hasAnyPanelAccessLazy(member)) groups[category.key].push(cmd);
        continue;
      }
      if (!canUse(cmd.permission)) continue;
      groups[category.key].push(cmd);
    }
  }
  return groups;
}

const TIER_HIGHLIGHTS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.highlights || []]));

/**
 * Les quelques commandes mises en avant sur la carte d'une catégorie à
 * l'accueil. On part des "vedettes" curées dans le catalogue
 * (utils/commandCatalog.js::highlights, les commandes emblématiques du
 * thème), mais on ne garde QUE celles auxquelles ce membre a réellement
 * accès — une pastille ne doit jamais promettre une commande que la
 * personne ne peut pas lancer. Si aucune vedette n'est accessible, on
 * retombe sur ses premières commandes disponibles, pour ne pas afficher une
 * carte muette.
 * @param {string} tier clé de catégorie
 * @param {object[]} accessibles commandes de cette catégorie déjà filtrées sur les droits du membre
 */
function highlightsFor(tier, accessibles) {
  const disponibles = dedupeByIdentity(accessibles).map((e) => identityOf(e.cmd));
  const vedettes = TIER_HIGHLIGHTS[tier].filter((id) => disponibles.includes(id));
  return (vedettes.length ? vedettes : disponibles).slice(0, 4);
}

/**
 * Menu déroulant de navigation entre catégories + "Accueil". Une rangée de
 * boutons occupait presque tout l'écran sur mobile (8 boutons = 5 rangées
 * empilées), alors qu'un menu tient sur une seule ligne quel que soit le
 * nombre de catégories. La catégorie ouverte est marquée par
 * `setDefault` — l'état "sélectionné" natif des menus, que les boutons
 * n'ont pas.
 */
function buildCategorySelect(availableTiers, current, authorId) {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel("Accueil")
      .setValue("home")
      .setEmoji("🏠")
      .setDescription("Toutes les catégories en un coup d'oeil")
      .setDefault(current === null),
    ...availableTiers.map((tier) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(TIER_LABELS[tier])
        .setValue(tier)
        .setEmoji(TIER_EMOJI[tier])
        // Discord plafonne la description d'une option à 100 caractères.
        .setDescription(TIER_DESCRIPTIONS[tier].slice(0, 100))
        .setDefault(tier === current)
    ),
  ];
  return new StringSelectMenuBuilder()
    .setCustomId(`${SELECT_ID}:${authorId}`)
    .setPlaceholder("Choisir une catégorie")
    .addOptions(options);
}

/** Pagination de la catégorie active, même style que utils/listCard.js::buildListCard. */
function buildPageSelect(tier, page, totalPages, authorId) {
  const options = [];
  if (page > 0) options.push(new StringSelectMenuOptionBuilder().setLabel("Page précédente").setValue(String(page - 1)));
  if (page < totalPages - 1) options.push(new StringSelectMenuOptionBuilder().setLabel("Page suivante").setValue(String(page + 1)));
  return new StringSelectMenuBuilder()
    .setCustomId(`${PAGE_SELECT_ID}:${authorId}:${tier}`)
    .setPlaceholder(`Page ${page + 1}/${totalPages}`)
    .addOptions(options);
}

/**
 * &help — "Centre de commandes" : à l'accueil, chaque catégorie thématique
 * en bloc (emoji + description courte, JAMAIS de compteur de commandes) ;
 * une catégorie choisie détaille ses commandes. Filtré sur les droits RÉELS
 * de la personne — même moteur que les commandes et le panel
 * (utils/permissions/engine.js), pas une liste séparée qui pourrait diverger.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} [tier] catégorie active (une clé de CATEGORIES, ou null pour l'accueil)
 * @param {string} authorId qui a lancé &help — seul lui peut piloter la navigation
 * @param {number} [page] page de commandes affichée dans la catégorie active
 */
function buildHelpSpec(guildId, member, tier = null, authorId, page = 0) {
  const prefixes = getPrefixes(guildId);
  const groups = groupByTier(member);
  const availableTiers = TIER_ORDER.filter((t) => groups[t].length);
  const activeTier = availableTiers.includes(tier) ? tier : null;

  let clampedPage = 0;
  let totalPages = 1;
  let spec;

  if (activeTier) {
    // Catégorie ouverte : ses commandes réparties en colonnes PAR PALIER
    // (Publiques / Configurables / Sys) — le regroupement de l'ancien &help,
    // remis dans la grille. Le nom affiché est la syntaxe complète à taper,
    // préfixe réel compris : une image ne se copie pas, autant qu'elle
    // montre exactement quoi écrire.
    const entries = dedupeByIdentity(groups[activeTier]);

    // Une colonne = un paquet d'un même palier. Un palier qui déborde
    // s'étale sur plusieurs colonnes (marquées "suite") au lieu de laisser
    // une colonne quasi vide à côté d'une colonne pleine : c'est ce qui
    // recréait les grands blancs. Chaque page prend les 3 colonnes
    // suivantes, donc aucune page n'est à moitié vide.
    const colonnes = [];
    for (const palier of PALIERS) {
      const duPalier = entries.filter((e) => palierDe(e.cmd) === palier.cle);
      for (let i = 0; i < duPalier.length; i += PAR_COLONNE) {
        colonnes.push({
          cle: palier.cle,
          titre: i === 0 ? palier.titre : `${palier.titre} (suite)`,
          couleur: palier.couleur,
          entries: duPalier.slice(i, i + PAR_COLONNE),
        });
      }
    }

    totalPages = Math.max(1, Math.ceil(colonnes.length / COLONNES_PAR_PAGE));
    clampedPage = Math.min(Math.max(0, page), totalPages - 1);

    spec = {
      titre: TIER_LABELS[activeTier],
      sousTitre: `${identiteAffichee(member, authorId)} · Préfixe : ${prefixes.musicMod} · [ ] facultatif, < > obligatoire`,
      cartes: colonnes.slice(clampedPage * COLONNES_PAR_PAGE, (clampedPage + 1) * COLONNES_PAR_PAGE).map((c) => ({
        cle: c.cle,
        titre: c.titre,
        couleur: c.couleur,
        items: c.entries.map((e) => ({
          nom: `${prefixePour(e.cmd, prefixes)}${e.cmd.name}`,
          // Description ramenée à sa première proposition : en deux colonnes,
          // la version longue se faisait couper en plein milieu d'une phrase.
          // Les alias restent visibles : sans eux, `&avatar` semblerait ne
          // pas exister.
          description: e.aliases.length ? `${resumer(e.cmd.description)} · alias : ${e.aliases.join(", ")}` : resumer(e.cmd.description),
        })),
      })),
      pied: totalPages > 1 ? `Page ${clampedPage + 1} / ${totalPages}` : undefined,
      hauteursLibres: true,
    };
  } else {
    // Accueil : une carte par catégorie, en grille — les commandes montrées
    // sont les vedettes du thème filtrées sur les droits réels du membre.
    spec = {
      titre: "Centre de commandes",
      sousTitre: `${identiteAffichee(member, authorId)} · Préfixe : ${prefixes.musicMod}`,
      cartes: availableTiers.map((t) => {
        const parIdentite = new Map(dedupeByIdentity(groups[t]).map((e) => [identityOf(e.cmd), e.cmd]));
        return {
          cle: t,
          titre: TIER_LABELS[t],
          sousTitre: TIER_DESCRIPTIONS[t],
          couleur: TIER_COLORS[t] || COULEUR_PAR_DEFAUT,
          // Le nom porte son VRAI préfixe (certaines commandes n'en ont
          // aucun), et une pastille de palier dit d'un coup d'œil qui peut
          // s'en servir — la couleur reprend celle des colonnes de la vue
          // détaillée, pour que les deux écrans se lisent pareil.
          items: highlightsFor(t, groups[t]).map((id) => {
            const cmd = parIdentite.get(id);
            const palier = cmd ? palierDe(cmd) : "public";
            return {
              nom: `${cmd ? prefixePour(cmd, prefixes) : ""}${id}`,
              description: resumer(cmd?.description),
              couleurPastille: PALIERS.find((p) => p.cle === palier).couleur,
            };
          }),
          vide: "Aucune commande accessible",
        };
      }),
      // Légende des pastilles : sans elle, les trois couleurs ne veulent rien
      // dire pour qui découvre le bot.
      pied: "Tape une commande pour commencer",
    };
    if (!availableTiers.length) {
      spec.cartes = [{ titre: "Aucun accès", couleur: COULEUR_PAR_DEFAUT, items: [], vide: "Aucune commande accessible." }];
      spec.pied = undefined;
    }
  }

  return { spec, availableTiers, activeTier, clampedPage, totalPages };
}

/**
 * &help — "Centre de commandes". Le tableau de bord lui-même est une IMAGE
 * (utils/dashboardImage.js) affichée dans un Container Components V2 :
 * Discord ne sait pas disposer du texte en colonnes, c'est la seule façon
 * d'obtenir une vraie grille de cartes et une couleur par catégorie. Les
 * boutons de navigation, eux, restent de vrais composants Discord.
 * Le contenu vient des droits RÉELS de la personne — même moteur que les
 * commandes et le panel (utils/permissions/engine.js).
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} [tier] catégorie active (une clé de CATEGORIES, ou null pour l'accueil)
 * @param {string} authorId qui a lancé &help — seul lui peut piloter la navigation
 * @param {number} [page] page de commandes affichée dans la catégorie active
 * @param {{sansImage?: boolean}} [options] `sansImage` force le repli TEXTE —
 *   utilisé après un envoi refusé par Discord (voir utils/musicCommands.js) :
 *   inutile de redessiner une image que le salon n'acceptera pas davantage.
 */
function buildHelpPanel(guildId, member, tier = null, authorId, page = 0, { sansImage = false } = {}) {
  const { spec, availableTiers, activeTier, clampedPage, totalPages } = buildHelpSpec(guildId, member, tier, authorId, page);
  // `null` = le dessin a échoué (rendreEnCache journalise le motif). &help
  // est la seule porte d'entrée du bot pour qui ne le connaît pas : elle
  // repasse en texte plutôt que de ne rien répondre.
  const png = sansImage ? null : rendreEnCache(spec);

  // AUCUNE couleur d'accent : demande explicite, sur &help comme sur
  // &panel. La barre teintée à gauche du conteneur n'apportait rien.
  const container = new ContainerBuilder();
  if (png) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${NOM_IMAGE}`))
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(enTexte(spec)));
  }

  if (availableTiers.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildCategorySelect(availableTiers, activeTier, authorId)));
    if (activeTier && totalPages > 1) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(buildPageSelect(activeTier, clampedPage, totalPages, authorId)));
    }
  }

  // Sans image, PAS de `files` : un MediaGallery pointant sur une pièce
  // jointe absente ferait refuser tout le message par Discord.
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    ...(png ? { files: [new AttachmentBuilder(png, { name: NOM_IMAGE })] } : {}),
  };
}

/**
 * Toutes les interactions "help_tier:<authorId>:<catégorie|home>" (bouton de
 * navigation, revient à la page 0) ET "help_page:<authorId>:<catégorie>"
 * (menu de pagination dans la catégorie active) — voir index.js. Message
 * PUBLIC et unique, édité en place à chaque clic — jamais de nouveau message
 * — mais réservé à qui a lancé &help : n'importe qui d'autre verrait une
 * catégorie filtrée sur SES droits à lui, potentiellement plus larges,
 * affichée publiquement dans le salon.
 */
async function handleHelpInteraction(interaction) {
  // Les deux menus encodent l'auteur dans le customId ; la valeur choisie
  // (catégorie ou numéro de page) vient de `values`, comme tout menu déroulant.
  const [kind, authorId, tierDuCustomId] = interaction.customId.split(":");
  if (interaction.user.id !== authorId) {
    return interaction
      .reply({ content: "Seule la personne qui a lancé `&help` peut utiliser ce menu.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
  const estPagination = kind === PAGE_SELECT_ID;
  const page = estPagination ? parseInt(interaction.values?.[0], 10) || 0 : 0;
  const tier = estPagination ? tierDuCustomId : interaction.values?.[0] || null;
  // `attachments: []` UNIQUEMENT ici : sur une ÉDITION, Discord conserve les
  // pièces jointes existantes quand le champ est absent — le message
  // accumulerait une image de plus à chaque clic. À la création (message.reply
  // dans musicCommands.js), au contraire, ce champ écraserait la liste que
  // discord.js construit pour l'upload et l'image ne s'afficherait pas.
  const editer = (sansImage) =>
    interaction.update({
      ...buildHelpPanel(interaction.guild.id, interaction.member, tier, authorId, page, { sansImage }),
      attachments: [],
    });
  // Une édition refusée (pièce jointe interdite dans le salon) laissait le
  // clic sans réponse : la personne voit « Échec de l'interaction » et &help
  // reste bloqué sur la page précédente. On rejoue alors la même page en
  // texte, comme le fait le premier envoi (utils/musicCommands.js).
  return editer(false).catch((err) => {
    console.error("[helpPanel] interaction.update a échoué :", err);
    return editer(true).catch((err2) => console.error("[helpPanel] repli texte refusé lui aussi :", err2));
  });
}

module.exports = { buildHelpPanel, buildHelpSpec, handleHelpInteraction, identityOf, SELECT_ID, PAGE_SELECT_ID, ACCENT_COLOR };
