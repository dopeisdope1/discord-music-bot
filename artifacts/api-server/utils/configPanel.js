const {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix, prefixConflicts, prefixConflictMessage } = require("./prefixStore");
const { EMOJI } = require("./emojis");
const { rendreEnCache, resumer, enTexte, texteAlternatif, THEME_BLEU } = require("./dashboardImage");
const sectionDashboard = require("./sectionDashboard");
const { rendreCarteActionSync, prechargerAvatar, avatarDe, nomDe } = require("./actionCard");
const accessStore = require("./accessStore");
const { can, peutGererNiveaux } = require("./permissions/engine");
const levelStore = require("./permissions/levelStore");
const { LEVEL_MIN, LEVEL_MAX, keysForLevel } = require("./permissions/levelCatalog");
const commandRules = require("./commandRules");
const confessStore = require("./confessStore");
const { buildConfessCard } = require("./confessions");
const { commandsForKeys } = require("./permsCommands");
const blockedChannelsStore = require("./permissions/blockedChannelsStore");
const { addCards, addBackButton, addPager } = require("./panelCards");
const rolePresets = require("./rolePresets");
const { sweepGuild, pruneDeletedRoles } = require("./permissions/cleanup");
const { majSure, banniereSurPanel, texteDUnEmbed } = require("./componentsV2");
const { checkBotPermission } = require("./moderation/actions");
const { getAllLogChannels, setLogChannelId, CATEGORY_LABELS: LOG_CATEGORY_LABELS } = require("./modLogStore");
const statsStore = require("./statsStore");
const { LOG_CHANNEL_NAMES, createLogChannelsAutomatically, deleteLogChannelsAutomatically } = require("./logChannels");
const leaveStore = require("./leaveStore");
const autoroleStore = require("./autoroleStore");
const verificationStore = require("./verificationStore");
const welcomeStore = require("./welcomeStore");
const ticketStore = require("./ticketStore");
const { computeSecurityScan } = require("./securityScan");
const { computeStatus, formatUptime } = require("./statusDiagnostic");
const { FORMS, setFormState, buildFormCard } = require("./commandForms");
const { fakeMessage } = require("./fakeMessage");
const { utilityHandlers } = require("./utilityCommands");
const giveawayStore = require("./giveawayStore");
const { endGiveaway, rerollGiveaway } = require("./giveaways");
const { handleEmbedButton } = require("./serverExtra");
const backupStore = require("./serverBackupStore");
const { backup, countChannels, PRESET_BACKUPS } = require("./serverBackup");
const botProfileStore = require("./botProfileStore");
const { botProfileHandlers, STATUS_LABELS } = require("./botProfileCommands");

// Noms donnés aux salons créés par le bouton "Créer les salons
// automatiquement" (rubrique Logs) — ASCII simple, pas d'accent, pour éviter
// tout souci d'encodage sur un nom de salon.
// Préréglages pour la rubrique Bienvenue — 0 = jamais supprimé.
const WELCOME_DELETE_OPTIONS = [
  { label: "10 secondes", seconds: 10 },
  { label: "30 secondes", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "5 minutes", seconds: 300 },
  { label: "Jamais", seconds: 0 },
];

// Tous les identifiants d'interaction du panneau commencent par "cfg:", ce
// qui permet à index.js de les router sans les énumérer un par un.
const ID = "cfg";


// Chaque rubrique déclare comment décider si elle est visible : `ownerOnly`
// (uniquement le propriétaire), `permission` (une clé du catalogue,
// résolue via engine.can — "sys" y compris, qui n'est jamais une clé
// octroyable et ne laisse donc passer QUE owner/sys, par construction de
// engine.can), ou `visible(member)` pour un besoin plus fin (ex : lecture
// OU écriture suffisent). Rien = toujours visible (page d'accueil).
const SECTIONS = [
  { key: "home", label: "Accueil", description: "Vue d'ensemble de la configuration" },
  { key: "prefixes", label: "Préfixes", description: "Gestion, modération, sécurité et vocal", permission: "sys" },
  { key: "moderation", label: "Dispenses", description: "Qui échappe au quota de nettoyage", permission: "sys" },
  {
    key: "permissions",
    label: "Permissions",
    description: "Niveaux (1-9), cooldowns par commande, accès direct, salons bloqués",
    permission: "panel.permissions.manage",
  },
  {
    key: "logs",
    label: "Logs",
    description: "Salon de logs par catégorie (modération/membres/serveur/bots)",
    visible: (member) => can(member, "logs.view") || can(member, "logs.manage"),
  },
  { key: "stats", label: "Statistiques", description: "Compteurs serveur et activité des 7 derniers jours", permission: "server.stats.view" },
  { key: "diagnostics", label: "Diagnostics", description: "Uptime, latence et mémoire", permission: "sys" },
  { key: "welcome", label: "Bienvenue", description: "Message de bienvenue à l'arrivée d'un membre", permission: "server.welcome.manage" },
  { key: "leave", label: "Départ", description: "Message envoyé quand un membre quitte le serveur", permission: "server.welcome.manage" },
  { key: "autorole", label: "Rôles automatiques", description: "Rôles donnés automatiquement à l'arrivée", permission: "members.autorole.manage" },
  { key: "verification", label: "Vérification", description: "Rôle et salon du bouton \"Se vérifier\"", permission: "members.verification.manage" },
  { key: "tickets", label: "Tickets", description: "Rôle staff des tickets (voir &ticket setup)", permission: "server.tickets.manage" },
  {
    key: "confessions",
    label: "Confessions",
    description: "Salon public et salon de validation des confessions anonymes",
    visible: (member) => can(member, "server.confessions.setup") || can(member, "server.confessions.validation") || can(member, "server.confessions.manage"),
  },
  { key: "channels", label: "Salons", description: "Sélectionner plusieurs salons et les supprimer d'un coup", permission: "channels.manage" },
  { key: "giveaways", label: "Giveaways", description: "Giveaways en cours : démarrer, terminer, reroll", permission: "server.giveaways.manage" },
  { key: "embedBuilder", label: "Constructeur d'embed", description: "Composer et envoyer un embed dans un salon", permission: "server.channels.manage" },
  { key: "polls", label: "Sondages", description: "Créer un sondage (2 à 5 options)", permission: "server.polls.manage" },
  { key: "access", label: "Accès panel", description: "Qui a accès, nettoyage des accès obsolètes", permission: "sys" },
  { key: "backups", label: "Sauvegardes", description: "Structure du serveur : créer, restaurer, supprimer", permission: "sys" },
  { key: "botProfile", label: "Profil du bot", description: "Statut et nom du bot (partagés sur tous les serveurs)", permission: "sys" },
  { key: "sys", label: "Rang sys", description: "Qui a accès à tout le bot", ownerOnly: true },
  { key: "banall", label: "Ban de masse", description: "Qui peut lancer un ban de masse", ownerOnly: true },
];

function sectionVisible(section, member, isOwner) {
  // Indépendant des droits : une rubrique dont la fonctionnalité sous-jacente
  // est globalement coupée reste masquée pour tout le monde, y compris le
  // reste, et volontairement un champ distinct de `visible`/`permission` :
  // ceux-ci comptent pour hasAnyPanelAccess (une vraie vérification de droit),
  // alors qu'un simple interrupteur de fonctionnalité n'en est pas un.
  if (section.enabled === false) return false;
  if (section.key === "home") return true;
  if (section.ownerOnly) return isOwner;
  if (section.visible) return section.visible(member);
  return can(member, section.permission);
}

const sectionsFor = (member, isOwner) => SECTIONS.filter((s) => sectionVisible(s, member, isOwner));

/**
 * Vrai si la personne a accès à AU MOINS une rubrique qui exige un vrai droit
 * pour apparaître — condition d'entrée de &panel. Une rubrique sans
 * `permission`/`visible`/`ownerOnly` (Accueil — ni l'une ni l'autre
 * gated par le moteur de permissions)
 * est visible à tout le monde et NE COMPTE PAS ici : sinon &panel
 * deviendrait accessible à quiconque n'a strictement aucun droit, juste
 * parce qu'une rubrique publique existe.
 */
function hasAnyPanelAccess(member) {
  const isOwner = accessStore.isOwner(member.id);
  return sectionsFor(member, isOwner).some((s) => s.ownerOnly || s.visible || s.permission != null);
}

// Rubrique à rouvrir après avoir modifié une portée legacy (accessStore).
const SECTION_OF_SCOPE = { clear: "moderation", sys: "sys", banall: "banall" };

const mentions = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "*personne*");

// Rubriques regroupées par FAMILLE (centre de contrôle, refonte du panel) :
// le menu principal ne montre que les familles, un second menu n'apparaît
// que pour choisir une rubrique dans la famille ouverte. Onze familles
// cibles au total (Accueil/Sécurité/Modération/Serveur/Communauté/Support/
// Communication/Monitoring/Sauvegardes/Bot), toutes présentes
// désormais.
//
// Les écrans eux-mêmes ne sont PAS fusionnés — chacun garde ses contrôles et
// ses avertissements. "Rang sys" et "Ban de masse" voisinent dans la même
// famille sans jamais partager le même écran : l'un donne accès à tout le bot,
// l'autre bannit le serveur entier, et un mauvais clic ne pardonne pas.
// L'accueil du panel est rendu en image (même moteur que &help, voir
// utils/dashboardImage.js) : nom de fichier fixe, référencé par
// "attachment://" dans le composant MediaGallery.
const NOM_IMAGE_PANEL = "centre-de-gestion.png";
const NOM_IMAGE_RUBRIQUE = "rubrique.png";

// Une couleur par famille — c'est tout l'intérêt de l'image : un Container
// Components V2 n'a qu'UNE couleur d'accent pour tout le message.
// Une teinte par rubrique : c'est elle qui colore le liseré et le titre de
// l'image. Les sujets proches partagent une famille de couleur (protection en
// vert, communauté en ambre, réglages du bot en gris-bleu) pour que le panel
// garde une cohérence malgré le nombre d'entrées.
// Refonte visuelle (identité bleu-sombre) : une seule teinte d'accent sert de
// liseré/titre pour toutes les images du panel — voir utils/dashboardImage.js
// ::THEME_BLEU.accent, même source que le reste de la refonte.
const TEINTE_NEUTRE = THEME_BLEU.accent;

// Salons cochés dans la rubrique "Salons", en attente de suppression.
//
// En mémoire, PAR PERSONNE et par serveur : le `state` du panel ne survit pas
// au clic suivant, et les identifiants ne tiendraient pas dans un customId
// (100 caractères, contre 19 par salon). Rien n'est écrit sur disque — une
// sélection en cours n'a aucun intérêt après un redémarrage, et la faire
// survivre reviendrait à garder une liste de suppression armée.
const selectionsSalons = new Map();
const DUREE_SELECTION_MS = 10 * 60_000;

const cleSelection = (guildId, userId) => `${guildId}:${userId}`;

/** @returns {string[]} identifiants choisis, vide si rien ou si trop ancien */
function selectionSalons(guildId, userId) {
  const entree = selectionsSalons.get(cleSelection(guildId, userId));
  if (!entree) return [];
  // Périmée : une sélection oubliée une heure plus tôt ne doit pas pouvoir
  // être lancée par un clic distrait.
  if (Date.now() - entree.a > DUREE_SELECTION_MS) {
    selectionsSalons.delete(cleSelection(guildId, userId));
    return [];
  }
  return entree.ids;
}

function definirSelectionSalons(guildId, userId, ids) {
  if (!ids.length) selectionsSalons.delete(cleSelection(guildId, userId));
  else selectionsSalons.set(cleSelection(guildId, userId), { ids: [...new Set(ids)], a: Date.now() });
}

// Commandes listées nommément sur la fiche d'un rôle. Un rôle très doté en
// débloque plus de cent : les dessiner toutes ferait une image de plusieurs
// milliers de pixels de haut, où plus rien ne se lit. Le compte exact reste
// affiché juste au-dessus, et &perms donne la liste complète.
const MAX_COMMANDES_AFFICHEES = 27;
// Pagination façon capture de référence ("Page 3/3", flèches ◀/▶) pour les
// vues "Permissions" > niveau (ses commandes) et > choix de commande
// (cooldown/accès direct) — un menu déroulant Discord plafonne à 25 options,
// une commande par ligne de texte occupe bien moins.
const CMDS_PAR_PAGE = 10;
const FAMILY_COLORS = new Proxy({}, { get: () => TEINTE_NEUTRE });

// Le menu du panel liste des SUJETS CONCRETS — Logs, Bienvenue, Permissions,
// Giveaways — et non plus des familles abstraites
// ("Serveur", "Communauté", "Communication") dans lesquelles il fallait
// deviner ce qui se cachait. Demande explicite : « je veux genre des rubriques
// comme Logs, Sécurité, Bienvenue, Permission, Giveaway ».
//
// Chaque entrée ne contient qu'UNE rubrique — la famille "Sécurité"
// (vue d'ensemble/anti-spam/anti-nuke/rôle de mute), seule à en regrouper
// plusieurs jusqu'ici, a déménagé intégralement dans "!!secur" (voir
// utils/securityPanel.js — demande explicite : "enlève tout les trucs de
// sécurité du &panel et le mets dans !!secur").
//
// Un menu déroulant Discord accepte 25 options au maximum : la liste
// ci-dessous en compte moins.
const FAMILIES = [
  { key: "accueil", label: "Accueil", description: "Statut du bot et alertes de sécurité", sections: ["home"] },
  { key: "logs", label: "Logs", description: "Salon de logs par catégorie", sections: ["logs"] },
  { key: "bienvenue", label: "Bienvenue", description: "Message à l'arrivée d'un membre", sections: ["welcome"] },
  { key: "depart", label: "Départ", description: "Message quand un membre s'en va", sections: ["leave"] },
  { key: "salons", label: "Salons", description: "Supprimer plusieurs salons d'un coup", sections: ["channels"] },
  { key: "permissions", label: "Permissions", description: "Niveaux, cooldowns, accès direct, salons bloqués", sections: ["permissions"] },
  { key: "autorole", label: "Rôles automatiques", description: "Rôles donnés à chaque arrivée", sections: ["autorole"] },
  { key: "verification", label: "Vérification", description: "Bouton « Se vérifier » et rôle accordé", sections: ["verification"] },
  { key: "tickets", label: "Tickets", description: "Système de tickets d'assistance", sections: ["tickets"] },
  { key: "confessions", label: "Confessions", description: "Salon public et salon de validation", sections: ["confessions"] },
  { key: "giveaways", label: "Giveaways", description: "Concours en cours, tirage et reroll", sections: ["giveaways"] },
  { key: "sondages", label: "Sondages", description: "Créer un sondage à boutons", sections: ["polls"] },
  { key: "annonces", label: "Annonces", description: "Composer et envoyer un embed", sections: ["embedBuilder"] },
  { key: "statistiques", label: "Statistiques", description: "Compteurs et activité des 7 derniers jours", sections: ["stats"] },
  { key: "diagnostics", label: "Diagnostics", description: "Uptime, latence et mémoire", sections: ["diagnostics"] },
  { key: "sauvegardes", label: "Sauvegardes", description: "Sauvegarder et restaurer la structure", sections: ["backups"] },
  { key: "profil", label: "Profil du bot", description: "Nom, photo, bannière et statut du bot", sections: ["botProfile"] },
  { key: "prefixes", label: "Préfixes", description: "Gestion, modération, sécurité et vocal", sections: ["prefixes"] },
  { key: "acces", label: "Accès panel", description: "Qui peut ouvrir ce panneau", sections: ["access"] },
  { key: "sys", label: "Rang sys", description: "Qui a accès à tout le bot", sections: ["sys"] },
  { key: "banall", label: "Ban de masse", description: "Qui peut lancer un ban de masse", sections: ["banall"] },
  { key: "dispenses", label: "Dispenses", description: "Qui échappe au quota de nettoyage", sections: ["moderation"] },
];


const familyOf = (sectionKey) => FAMILIES.find((f) => f.sections.includes(sectionKey)) || FAMILIES[0];

/** Rubriques d'une famille auxquelles la personne a réellement droit. */
function familySections(family, member, isOwner) {
  const visibles = sectionsFor(member, isOwner);
  return family.sections.map((key) => visibles.find((s) => s.key === key)).filter(Boolean);
}

/**
 * Menu déroulant de navigation entre familles — même contrôle que &help
 * (identité partagée "Centre de commandes" / "Centre de gestion"). Une
 * rangée de boutons occupait presque tout l'écran sur mobile avec dix
 * familles ; un menu tient sur une ligne et marque la famille ouverte avec
 * `setDefault`. Reste, pour mémoire, l'ancienne logique : la famille active
 * ressortait en style Primary, les
 * autres en Secondary, réparties sur autant de rangées de 5 que nécessaire
 * (limite Discord par ActionRow). Remplace l'ancien menu déroulant.
 * @returns {import('discord.js').ActionRowBuilder[]}
 */
function buildNav(current, member, isOwner) {
  const famille = familyOf(current);
  const disponibles = FAMILIES.filter((f) => familySections(f, member, isOwner).length);
  return new StringSelectMenuBuilder()
    .setCustomId(`${ID}:nav`)
    .setPlaceholder("Choisir une famille")
    .addOptions(
      disponibles.map((f) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(f.label)
          .setValue(f.key)
          // Discord plafonne la description d'une option à 100 caractères.
          .setDescription(f.description.slice(0, 100))
          .setDefault(f.key === famille.key)
      )
    );
}

/**
 * Second menu, affiché seulement quand la famille ouverte contient plus d'une
 * rubrique visible : sinon il n'offrirait aucun choix.
 */
function buildSubNav(current, member, isOwner) {
  const rubriques = familySections(familyOf(current), member, isOwner);
  if (rubriques.length < 2) return null;
  return new StringSelectMenuBuilder()
    .setCustomId(`${ID}:subnav`)
    .setPlaceholder("Choisis une rubrique")
    .addOptions(
      rubriques.map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(s.label)
          .setDescription(s.description.slice(0, 100))
          .setValue(s.key)
          .setDefault(s.key === current)
      )
    );
}

// Lazy require : musicCommands.js importe configPanel.js (buildConfigPanel,
// hasAnyPanelAccess) — un require() en tête de fichier ici créerait une
// dépendance circulaire qui casse ces deux exports au chargement (observé :
// "Accessing non-existent property... inside circular dependency"). Appelée
// seulement au clic/affichage, une fois les deux modules déjà initialisés.
function allModCommandNames() {
  return require("./musicCommands").MOD_COMMAND_NAMES;
}

// Le corps d'une rubrique dit UNIQUEMENT ce qui est configuré en ce moment —
// une ligne "> **Réglage** : valeur" par réglage. Aucune explication de
// fonctionnement : le panel est un poste de commande, pas une documentation.
// Le "pourquoi" et le "comment" vivent dans le README et dans &help, où on
// peut les lire sans faire défiler un écran de contrôles.
function sectionBody(section, guild, member, state) {
  const guildId = guild.id;
  const prefixes = getPrefixes(guildId);
  const owners = accessStore.ownerIds();

  if (section === "prefixes") {
    return [`> **Préfixe gestion** : \`${prefixes.musicMod}\``].join("\n");
  }

  if (section === "moderation") {
    return [
      // La dispense « accès legacy aux salons » a été retirée sur demande :
      // il ne reste que celle qui sert vraiment, le quota de `uo clear`.
      `> **Dispensés du quota de \`uo clear\`** : ${mentions(accessStore.list("clear"))}`,
    ].join("\n");
  }

  // "Permissions" — 4 blocs : Permissions (niveaux 1-9), Cooldowns (par
  // commande), Permissions supplémentaires (accès direct à une commande),
  // Salons bloqués. `state.permView` choisit lequel est affiché ("levels" par
  // défaut) — voir buildConfigPanel pour les composants de chaque vue.
  if (section === "permissions") {
    // Rien à renvoyer ICI (voir buildConfigPanel > meta.key === "permissions"
    // pour le vrai rendu) : chaque carte (addCards/panelCards.js) porte déjà
    // son propre titre+description, directement liés à son bouton par le
    // même bloc. Un texte-résumé ici ferait doublon — exactement le bug vu
    // sur mobile (résumé en haut, boutons détachés en dessous).
    return "";
  }

  if (section === "logs") {
    // Navigation hiérarchique : accueil = une sous-carte par catégorie de
    // logs, chacune ouvrant sa config de salon (state.logsCategory).
    const channels = getAllLogChannels(guildId);
    const manage = can(member, "logs.manage");

    if (!state.logsCategory) {
      const lignes = Object.entries(LOG_CATEGORY_LABELS).flatMap(([cat, label]) => [
        `**${label}**`,
        channels[cat] ? `<#${channels[cat]}>` : "*aucun — désactivé*",
        "",
      ]);
      lignes.pop();
      if (!manage) lignes.push("", "*Lecture seule — le droit `logs.manage` est requis pour modifier.*");
      return lignes.join("\n");
    }

    const catLabel = LOG_CATEGORY_LABELS[state.logsCategory];
    return [
      `> **Catégorie** : ${catLabel}`,
      `> **Salon** : ${channels[state.logsCategory] ? `<#${channels[state.logsCategory]}>` : "*aucun — désactivé*"}`,
    ].join("\n");
  }

  if (section === "stats") {
    const inVoice = guild.voiceStates.cache.filter((v) => v.channelId).size;
    const range = statsStore.getRange(guildId, 7);
    const totalMessages = range.reduce((sum, d) => sum + d.messages, 0);
    const totalJoins = range.reduce((sum, d) => sum + d.joins, 0);
    const totalLeaves = range.reduce((sum, d) => sum + d.leaves, 0);
    const lines = [
      `> **Membres** : ${guild.memberCount.toLocaleString("fr-FR")} · **rôles** : ${guild.roles.cache.size} · **salons** : ${guild.channels.cache.size} · **en vocal** : ${inVoice}`,
      `> **7 derniers jours** : ${totalMessages} message(s) · ${totalJoins} arrivée(s) · ${totalLeaves} départ(s)`,
    ];
    const lastDays = range.slice(-3);
    if (lastDays.length) {
      lines.push("", "**Détail (3 derniers jours) :**");
      // Libellés en toutes lettres, pas en emojis : la rubrique est DESSINÉE
      // (utils/sectionDashboard.js) et la police embarquée n'a aucun glyphe
      // emoji — « 💬 0 · 🟢 0 · 🔴 0 » sortirait en « 0 · 0 · 0 » entre des
      // carrés vides. Même formulation que la ligne « 7 derniers jours »
      // juste au-dessus, qui était déjà en mots.
      for (const d of lastDays) lines.push(`> **${d.date}** : ${d.messages} message(s) · ${d.joins} arrivée(s) · ${d.leaves} départ(s)`);
    }
    return lines.join("\n");
  }

  if (section === "diagnostics") {
    const info = computeStatus(guild.client);
    return [
      `> **Uptime** : ${formatUptime(info.uptimeMs)} · **latence** : ${info.ping}ms · **mémoire** : ${info.memoryRssMB} Mo`,
      `> **Serveurs** : ${info.guildCount} · **Node.js** : ${info.nodeVersion} · **discord.js** : v${info.discordjsVersion}`,
    ].join("\n");
  }

  if (section === "welcome") {
    const config = welcomeStore.getConfig(guildId);
    const lines = config.messages.length
      ? config.messages.map((m, i) => `${i + 1}. *${m}*`).join("\n")
      : "*Aucun message configuré — le message de bienvenue reste désactivé tant qu'il n'y en a pas au moins un.*";
    return [
      `> **Salon** : ${config.channelId ? `<#${config.channelId}>` : "*aucun — désactivé*"}`,
      `> **Suppression auto** : ${config.autoDeleteSeconds ? `${config.autoDeleteSeconds} secondes` : "jamais"}`,
      "",
      "**Messages** (un est tiré au hasard à chaque arrivée) :",
      lines,
    ].join("\n");
  }

  if (section === "leave") {
    const config = leaveStore.getConfig(guildId);
    const lines = config.messages.length
      ? config.messages.map((m, i) => `${i + 1}. *${m}*`).join("\n")
      : "*Aucun message configuré — le message de départ reste désactivé tant qu'il n'y en a pas au moins un.*";
    return [
      `> **Salon** : ${config.channelId ? `<#${config.channelId}>` : "*aucun — désactivé*"}`,
      `> **Suppression auto** : ${config.autoDeleteSeconds ? `${config.autoDeleteSeconds} secondes` : "jamais"}`,
      "",
      "**Messages** (un est tiré au hasard à chaque départ, \"{user}\" = pseudo de la personne) :",
      lines,
    ].join("\n");
  }

  if (section === "autorole") {
    const roles = autoroleStore.getRoleIds(guildId).map((id) => guild.roles.cache.get(id)).filter(Boolean);
    return [
      "**Rôles donnés automatiquement à chaque arrivée :**",
      roles.length ? roles.map((r) => `> ${r}`).join("\n") : "*Aucun rôle configuré.*",
    ].join("\n");
  }

  if (section === "verification") {
    const config = verificationStore.getConfig(guildId);
    const role = config.roleId && guild.roles.cache.get(config.roleId);
    return [
      `> **Rôle donné** : ${role ? role : "*aucun — non configuré*"}`,
      `> **Salon du bouton** : ${config.channelId ? `<#${config.channelId}>` : "*pas encore posté*"}`,
    ].join("\n");
  }

  if (section === "access") {
    const rows = [];
    for (const userId of accessStore.list("sys")) rows.push([userId, "rang sys"]);
    for (const userId of accessStore.list("banall")) rows.push([userId, "ban de masse"]);
    for (const [userId, level] of levelStore.listUserLevels(guildId)) rows.push([userId, `niveau individuel (${level}/9)`]);

    const seen = new Set();
    const lines = rows
      .filter(([userId]) => (seen.has(userId) ? false : seen.add(userId)))
      .map(([userId]) => {
        const present = guild.members.cache.has(userId);
        return `> <@${userId}> — ${present ? "membre" : "absent du serveur"}`;
      });

    return [
      lines.length ? lines.join("\n") : "*Personne n'a d'accès individuel enregistré sur ce serveur.*",
    ].join("\n");
  }

  if (section === "sys") {
    return [
      `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
    ].join("\n");
  }

  if (section === "backups") {
    const saved = backupStore.listBackups();
    const presets = Object.keys(PRESET_BACKUPS).map((name) => ({
      name,
      sourceGuildName: PRESET_BACKUPS[name].sourceGuildName,
      channelCount: countChannels(PRESET_BACKUPS[name]),
      preset: true,
    }));
    const all = [...presets, ...saved];
    if (!all.length) return "> *Aucune sauvegarde enregistrée.*";
    return all
      .map((b) => `> **${b.name}**${b.preset ? " *(préréglage)*" : ""} — ${b.channelCount} salon(s) — ${b.sourceGuildName}`)
      .join("\n");
  }

  if (section === "botProfile") {
    const config = botProfileStore.getConfig();
    const activity = config.activities?.[config.rotateIndex % (config.activities.length || 1)];
    return [
      `> **Statut** : ${STATUS_LABELS[config.status] || config.status}`,
      `> **Activité** : ${config.activityType && activity ? `${config.activityType} — ${activity}` : "*aucune*"}`,
      config.activities?.length > 1 ? `> **Rotation** : ${config.activities.length} phrase(s)` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  if (section === "tickets") {
    const config = ticketStore.getConfig(guildId);
    const role = (id) => (id && guild.roles.cache.has(id) ? `<@&${id}>` : null);
    const categorie = config.categoryId && guild.channels.cache.get(config.categoryId);
    return [
      `> **Rôle qui voit les tickets** : ${role(config.staffRoleId) || "*aucun — seul le demandeur y a accès*"}`,
      // Sans rôle dédié, c'est le rôle staff qui ferme : on le dit, plutôt que
      // d'afficher "aucun" et de laisser croire que personne ne peut fermer.
      `> **Rôle qui peut fermer** : ${
        role(config.closeRoleId) || (role(config.staffRoleId) ? `${role(config.staffRoleId)} *(le rôle staff)*` : "*aucun*")
      }`,
      `> **Le demandeur peut fermer son ticket** : ${config.ownerCanClose ? "oui" : "non"}`,
      `> **Catégorie des tickets** : ${categorie ? `<#${categorie.id}>` : "*aucune — créés à la racine*"}`,
    ].join("\n");
  }

  if (section === "channels") {
    const choisis = selectionSalons(guildId, member.id);
    const existants = choisis.map((id) => guild.channels.cache.get(id)).filter(Boolean);
    const lignes = [
      "> Choisis les salons à supprimer dans le menu, puis lance la suppression.",
      `> **Sélection** : ${existants.length ? existants.map((c) => `<#${c.id}>`).join(", ") : "*aucun salon choisi*"}`,
    ];
    if (existants.length) {
      // Le rappel est délibérément explicite : c'est la seule action du panel
      // qui détruit des messages, et rien ne permet de les récupérer ensuite.
      lignes.push(
        "",
        `**${existants.length} salon(s) seront supprimés DÉFINITIVEMENT**, avec tout leur historique de messages.`,
        "-# `&backup` ne sauvegarde que la structure du serveur, jamais les messages."
      );
    }
    return lignes.join("\n");
  }

  if (section === "giveaways") {
    const active = giveawayStore
      .listForGuild(guildId)
      .filter((g) => !g.ended)
      .sort((a, b) => a.endsAt - b.endsAt);
    if (!active.length) return "> *Aucun giveaway en cours.*";
    const lines = active.slice(0, 5).map((g) => {
      const when = `<t:${Math.floor(g.endsAt / 1000)}:R>`;
      const gagnants = (g.winnersCount || 1) > 1 ? ` — ${g.winnersCount} gagnants` : "";
      return `> **${g.prize}** — <#${g.channelId}> — se termine ${when} — ${g.participants.length} participant(s)${gagnants}`;
    });
    return ["**Giveaways en cours :**", ...lines].join("\n");
  }

  if (section === "embedBuilder") {
    return "> *Aucun réglage — le bouton ci-dessous ouvre le même constructeur d'embed que `&embed`.*";
  }

  if (section === "polls") {
    return "> *Sondages en mémoire, perdus au redémarrage du bot — le bouton ci-dessous ouvre le même formulaire que `&poll`.*";
  }

  if (section === "banall") {
    return [
      `> **Autorisés** : ${mentions(accessStore.list("banall"))}`,
      // Exception assumée à la règle "pas de prose" : c'est le seul écran du
      // panel dont un mauvais clic bannit le serveur entier.
      "> ⚠️ *`banall` bannit tout le serveur d'un coup. Le propriétaire y a toujours droit sans figurer ici.*",
    ].join("\n");
  }

  if (section === "confessions") {
    const cfg = confessStore.getConfig(guildId) || {};
    return [
      `> **Salon public** : ${cfg.channelId ? `<#${cfg.channelId}>` : "*non configuré*"}`,
      `> **Salon de validation** : ${cfg.validationChannelId ? `<#${cfg.validationChannelId}>` : "*non configuré*"}`,
    ].join("\n");
  }

  if (section === "home") {
    // Accueil épuré (refonte UX demandée explicitement) : statut + stats
    // serveur toujours visibles (uptime/latence ne révèlent aucun détail
    // d'infrastructure — le diagnostic complet reste réservé au rang sys
    // dans Monitoring), puis au plus DEUX alertes, les plus graves d'abord.
    // Plus d'activité récente ici : elle alourdissait l'accueil pour un
    // usage déjà couvert par Modération > Historique.
    const lines = [];

    const info = computeStatus(guild.client);
    lines.push(`🟢 En ligne — ${formatUptime(info.uptimeMs)} · ${info.ping}ms`);

    const inVoice = guild.voiceStates.cache.filter((v) => v.channelId).size;
    lines.push(`👥 ${guild.memberCount.toLocaleString("fr-FR")} membres · ${guild.channels.cache.size} salons · ${inVoice} en vocal`);

    // Même détection que `&security scan`, sur le cache déjà en mémoire (pas
    // de fetch ici, voir le commentaire dans securityScan.js) : un coup
    // d'œil instantané, pas un audit complet — celui-ci reste dans
    // Sécurité > Vue d'ensemble, jamais dupliqué ici.
    if (can(member, "protection.automod")) {
      const { critical, warnings } = computeSecurityScan(guild);
      lines.push("");
      if (!critical.length && !warnings.length) {
        lines.push("🟢 Tout est en ordre.");
      } else {
        const top = [...critical.map((l) => ["🔴", l]), ...warnings.map((l) => ["🟠", l])].slice(0, 2);
        for (const [emoji, l] of top) lines.push(`${emoji} ${l}`);
      }
    }

    return lines.join("\n");
  }

  return [
    `> **Préfixe gestion** : \`${prefixes.musicMod}\``,
    `> **Propriétaire(s)** : ${mentions(owners)}`,
    `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
    `> **Rôles avec un niveau assigné** : ${levelStore.listRoleLevels(guildId).length}`,
  ].join("\n");
}

/**
 * Adapte une interaction en objet "message" minimal pour réutiliser
 * TEL QUEL utils/serverAdminCommands.js::roleAdmin (create/delete déjà
 * testés, avec confirmation et journalisation) plutôt que réimplémenter la
 * création/suppression de rôle depuis le panel.
 */
/**
 * @param {import('discord.js').Interaction} interaction
 * @param {{ section: string, state?: object }} [retour] quand fourni, le
 *   résultat (roleAdmin/backup/rolePresets...) ne remplace plus le panneau
 *   par une confirmation isolée — il revient sur CETTE rubrique du panel,
 *   la confirmation affichée en bannière au-dessus. Sans lui, comportement
 *   inchangé (confirmation seule) pour les appelants qui n'ont pas encore
 *   de rubrique de retour évidente.
 */
function messageFromInteraction(interaction, retour) {
  // Fonction plutôt que {section, state} directement : ce même objet
  // "message" peut être transmis à utils/serverAdminCommands.js::
  // requestConfirmation (confirmation à deux temps, ex: suppression de
  // rôle) via `message.retour` — un require de buildConfigPanel depuis
  // serverAdminCommands.js créerait un cycle (configPanel.js requiert déjà
  // serverAdminCommands.js pour roleAdmin). En exposant directement la
  // fonction de construction, l'appelant (ici) reste le seul à connaître
  // buildConfigPanel ; serverAdminCommands.js se contente de l'appeler.
  const construirePanel = retour ? (i) => buildConfigPanel(i.guild, retour.section, i.member, retour.state || {}, {}) : null;
  return {
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    author: interaction.user,
    mentions: { roles: { first: () => null } },
    retour: construirePanel,
    // update(), pas reply() : on vient toujours d'un clic sur LE panneau
    // (bouton, modale ouverte depuis un bouton), donc le résultat doit
    // remplacer son contenu, pas ouvrir un second message replié
    // ("Clique pour voir le message") à côté. Même principe que la carte de
    // formulaire lancée depuis le panel (voir utils/fakeMessage.js::
    // remplacerParLaReponse), appliqué ici aux commandes admin de rôle/salon
    // (create/rename/delete...) et à leur confirmation
    // (utils/serverAdminCommands.js::requestConfirmation).
    // majSure (pas interaction.update direct) : roleAdmin/backup/rolePresets
    // répondent par un embed classique, et le panneau qu'on remplace est en
    // Components V2 — sans conversion, Discord refuse tout le message
    // (embeds[MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2], observé
    // en production).
    reply: (payload) => {
      // Une carte AVEC ses propres composants/fichiers (ex: la confirmation
      // en image avant suppression, utils/serverAdminCommands.js::
      // requestConfirmation) doit rester elle-même pleinement interactive —
      // seul un résultat FINAL, simple embed de statut (buildStatusEmbed),
      // revient sur le panel. Sinon "Supprimer ce rôle" perdrait ses
      // boutons Supprimer/Annuler, remplacés par le panel avant même que la
      // confirmation ait pu s'afficher.
      const embedSeul = payload?.embeds?.length && !payload.files?.length && !payload.components?.length;
      if (!construirePanel || !embedSeul) return majSure(interaction, payload);
      // Demande explicite : une action lancée DEPUIS le panel doit y
      // ramener, jamais laisser la confirmation seule à la place ("&panel"
      // édité en simple "Rôle X créé.", sans retour possible au panel sans
      // le rouvrir). La confirmation reste visible, juste en bannière.
      const { texte } = texteDUnEmbed(payload.embeds[0]);
      return majSure(interaction, banniereSurPanel(construirePanel(interaction), texte));
    },
  };
}

/** Menus d'ajout/retrait pour une portée legacy (accessStore). */
function accessRows(scope, label) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`${ID}:add:${scope}`).setPlaceholder(`Ajouter — ${label}`)
    ),
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`${ID}:del:${scope}`).setPlaceholder(`Retirer — ${label}`)
    ),
  ];
}

/**
 * Panneau de configuration. Components V2 sans setAccentColor : pas de barre
 * de couleur sur le côté.
 * @param {import('discord.js').Guild} guild
 * @param {string} current
 * @param {import('discord.js').GuildMember} member qui consulte/modifie le panneau
 * @param {{ permissionsRoleId?: string, rolesRoleId?: string }} [state]
 */
/**
 * Ce qui est réellement DESSINÉ sur le tableau de bord de l'accueil du panel
 * (utils/dashboardImage.js) : une carte par famille, ses rubriques réelles
 * en lignes. Exporté pour que les tests vérifient le contenu de l'image —
 * autrement invérifiable une fois rendue en PNG.
 */

// L'accueil du panel ne dessine plus rien : ni grille de rubriques, ni
// bandeau d'état, ni alertes de sécurité. `buildHomeSpec` et
// `alertesSecurite` ont donc été retirés — ils n'étaient plus appelés que par
// leurs propres tests, ce qui donne l'illusion d'une couverture sur du code
// que personne n'exécute.
//
// Rien n'est perdu : l'état du bot est dans Diagnostics, les compteurs dans
// Statistiques, et la détection de sécurité vit là où elle a toujours vécu —
// utils/securityScan.js, exposée par Sécurité > Vue d'ensemble et par
// `&security scan`, qui la donne en entier.

/**
 * Ce qui est réellement DESSINÉ sur la rubrique `section` : la même donnée que
 * le corps texte, en structuré. Exporté pour que les tests vérifient le
 * contenu affiché sans avoir à lire une image — garantie plus solide qu'une
 * expression régulière sur du markdown.
 * @param {string} [corps] sortie de sectionBody(), recalculée si absente
 */
function buildSectionSpec(guild, section, member, state = {}, corps) {
  const meta = SECTIONS.find((s) => s.key === section) || SECTIONS[0];
  return sectionDashboard.enSpec(corps ?? sectionBody(meta.key, guild, member, state), {
    titre: meta.label,
    couleur: FAMILY_COLORS[familyOf(meta.key).key] || TEINTE_NEUTRE,
    sousTitre: `${member.displayName || member.user?.username || meta.label} · Gestion : ${getPrefixes(guild.id).musicMod}`,
    guild,
    // Nombre de colonnes laissé à enSpec : il le déduit de la longueur réelle
    // des lignes (deux colonnes seulement si rien n'y serait tronqué).
    // Identité visuelle de la refonte (fond/cartes bleu-sombre) — voir
    // utils/dashboardImage.js::THEME_BLEU.
    theme: THEME_BLEU,
  });
}

/**
 * @param {{sansImage?: boolean}} [options] `sansImage` force le repli TEXTE —
 *   posé après un envoi refusé par Discord (voir utils/musicCommands.js) :
 *   le salon qui refuse une pièce jointe refusera aussi la suivante.
 */
/**
 * Remplace TOUTES les rangées de boutons d'un écran par UN menu déroulant
 * d'actions. Demande explicite : « je veux plus de boutons, sinon ça fait
 * moche et trop d'options » — la fiche membre en alignait sept, l'écran des
 * permissions cinq.
 *
 * Fait après coup sur le conteneur déjà construit, plutôt que dans chacune
 * des vingt branches de rendu : un seul endroit à maintenir, et une rubrique
 * ajoutée plus tard en bénéficie sans rien changer. La valeur de chaque
 * option EST le customId du bouton d'origine, donc aucun handler n'a besoin
 * d'être réécrit — le routeur réexpédie simplement vers lui.
 *
 * Les boutons DÉSACTIVÉS sont écartés : un menu n'a pas d'option grisée, et
 * proposer une action impossible serait pire que de la masquer.
 */
/**
 * La rubrique "Permissions" (grande carte unique) n'a pas de state persistant
 * côté serveur — comme le reste du panel, chaque clic reconstruit l'écran à
 * partir de ce qu'un handler connaît déjà (extra/interaction.values). Pour
 * garder les AUTRES sections de la carte dans leur état au moment d'un clic
 * (ex : changer de page "Cooldowns" ne doit pas fermer "Permissions" ni
 * oublier la commande choisie dans "Permissions supplémentaires"), on relit
 * les valeurs par défaut déjà affichées sur le message avant d'y appliquer le
 * changement demandé par ce clic précis.
 * @param {import('discord.js').Message} message
 * @returns {object} état reconstruit (permOpen, permLevel, permCmdPage,
 *   permCmdListPage, permCmdNameCooldown, permCmdNameExtra)
 */
function lireStatePermissions(message) {
  const state = {};
  if (!message?.components) return state;
  for (const row of message.components) {
    for (const comp of row.components || []) {
      if (comp.customId === `${ID}:permlevel`) {
        state.permOpen = true;
        const choisi = comp.options?.find((o) => o.default);
        if (choisi) state.permLevel = parseInt(choisi.value, 10);
      } else if (comp.customId?.startsWith(`${ID}:permcmdname:cooldowns`)) {
        const choisi = comp.options?.find((o) => o.default);
        if (choisi) state.permCmdNameCooldown = choisi.value;
      } else if (comp.customId?.startsWith(`${ID}:permcmdname:extra`)) {
        const choisi = comp.options?.find((o) => o.default);
        if (choisi) state.permCmdNameExtra = choisi.value;
      }
    }
  }
  return state;
}

function regrouperBoutonsEnMenu(container) {
  const enfants = container.components;
  const boutons = [];
  let premiereRangee = -1;

  for (let i = enfants.length - 1; i >= 0; i--) {
    const json = enfants[i].toJSON?.();
    if (json?.type !== 1) continue;
    const composants = json.components || [];
    if (!composants.length || !composants.every((c) => c.type === 2)) continue;
    // Un bouton LIEN ouvre une URL : aucune option de menu ne sait faire ça.
    // Sa rangée est laissée telle quelle, sans quoi le lien disparaîtrait
    // purement et simplement (c'est arrivé au bouton « Ouvrir le lecteur »).
    if (composants.some((b) => !b.custom_id)) continue;
    boutons.unshift(...composants.filter((b) => !b.disabled));
    premiereRangee = i;
    enfants.splice(i, 1);
  }

  if (!boutons.length) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${ID}:action`)
    .setPlaceholder("Choisir une action")
    .addOptions(
      // L'emoji du bouton d'origine n'est PAS repris : les libellés suffisent,
      // et une colonne d'emojis dans un menu déroulant fait exactement le
      // bruit visuel qu'on cherchait à supprimer.
      boutons.slice(0, 25).map((b) => new StringSelectMenuOptionBuilder().setLabel(b.label || "Action").setValue(b.custom_id))
    );
  enfants.splice(premiereRangee, 0, new ActionRowBuilder().addComponents(menu));
}

function buildConfigPanel(guild, current = "home", member, state = {}, { sansImage = false } = {}) {
  const isOwner = accessStore.isOwner(member.id);
  const available = sectionsFor(member, isOwner);
  const meta = available.find((s) => s.key === current) || available[0];
  const famille = familyOf(meta.key);
  // AUCUNE couleur d'accent : demande explicite. La barre colorée à gauche du
  // conteneur ne portait aucune information, elle ne faisait que teinter le
  // message.
  const container = new ContainerBuilder();
  // Pièces jointes accumulées par l'écran courant.
  const fichiers = [];

  const enteteLignes = [
    "## 「 PANEL DE CONFIGURATION 」",
    `> <@${member.id}> · Gestion : \`${getPrefixes(guild.id).musicMod}\``,
  ];
  // Sur l'accueil, les cartes annoncent déjà chaque famille : répéter
  // "### Accueil" juste au-dessus n'apporterait rien. Le statut et les
  // alertes ne sont plus écrits ici non plus : en texte, les mentions
  // brutes sortaient en pastilles — un `@everyone` cité dans une alerte de
  // sécurité, notamment. Ils sont désormais DESSINÉS dans l'image de
  // l'accueil, où ils informent sans pouvoir notifier personne.
  if (meta.key !== "home") enteteLignes.push(`### ${meta.label}`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(enteteLignes.join("\n")));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (meta.key === "home") {
    // L'accueil ne porte plus RIEN : ni grille de rubriques (le menu juste en
    // dessous les liste déjà), ni bandeau d'état, ni alertes de sécurité.
    // Chacun de ces blocs a été retiré sur demande, le dernier au motif qu'il
    // était moche — et aucun n'était à sa place ici : &panel sert à ouvrir une
    // rubrique, pas à faire un rapport.
    //
    // Rien n'est perdu pour autant : l'uptime et la latence sont dans
    // Diagnostics, les compteurs dans Statistiques, et les alertes de sécurité
    // dans Sécurité > Vue d'ensemble comme dans `&security scan` — qui les
    // donne en entier plutôt que les deux plus graves.
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildNav(meta.key, member, isOwner)));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  // TOUTES les rubriques sont dessinées : demande explicite d'un bot "rempli
  // de tableaux de bord". Le contenu reste EXACTEMENT celui de sectionBody —
  // une seule source de vérité, la même que lisent les commandes texte
  // équivalentes — simplement converti en grille de cartes
  // (utils/sectionDashboard.js) au lieu d'être empilé en lignes de citation.
  const corps = sectionBody(meta.key, guild, member, state);
  // "Rôles (paliers)" reste en texte, comme &helpall — demande explicite,
  // par contraste avec "TOUTES les rubriques sont dessinées" ci-dessus : la
  // liste des paliers change souvent (ajout/suppression de rôle) et les
  // actions rapides juste en dessous (renommer/ajouter/supprimer) s'y
  // réfèrent directement, mieux servies par le vrai texte Discord (mentions
  // résolues) que par une image à régénérer à chaque clic.
  const texteForce = meta.key === "permissions";
  const specRubrique = texteForce ? null : buildSectionSpec(guild, meta.key, member, state, corps);
  const pngRubrique = sansImage || texteForce ? null : rendreEnCache(specRubrique);
  if (pngRubrique) {
    fichiers.push(new AttachmentBuilder(pngRubrique, { name: NOM_IMAGE_RUBRIQUE, description: texteAlternatif(specRubrique) }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${NOM_IMAGE_RUBRIQUE}`))
    );
  } else if (corps) {
    // Le corps d'origine, pas enTexte(spec) : ici le texte Discord est
    // MEILLEUR que sa transposition (il résout les mentions et les dates
    // tout seul). Le repli rend donc la rubrique telle qu'elle était.
    // "Permissions" n'a PAS de texte ici : chaque carte (addCards) porte déjà
    // son propre titre+description, un résumé en plus ferait le doublon vu
    // sur mobile (texte en haut + boutons à plat en dessous, sans lien
    // visuel entre les deux).
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(corps));
  }
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buildNav(meta.key, member, isOwner)));
  const subNav = buildSubNav(meta.key, member, isOwner);
  if (subNav) container.addActionRowComponents(new ActionRowBuilder().addComponents(subNav));

  if (meta.key === "prefixes") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:prefix:musicMod`).setLabel("Préfixe gestion").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "moderation") {
    for (const row of accessRows("clear", "dispense de nettoyage")) container.addActionRowComponents(row);
  } else if (meta.key === "permissions") {
    // UNE SEULE grande carte (demande explicite, screenshot de référence) :
    // le texte des 4 sections (Permissions/Cooldowns/Permissions
    // supplémentaires/Salons bloqués) reste TOUJOURS affiché en haut, dans
    // l'ordre, et TOUS leurs boutons/sélecteurs sont empilés à la suite —
    // jamais un écran qui en remplace un autre. Un sélecteur affiché "ouvre"
    // une section en ajoutant ses contrôles juste après son bouton, sans
    // rien masquer du reste de la carte.
    const niveau = state.permLevel;
    const peutModifier = peutGererNiveaux(member);
    const nbBloques = blockedChannelsStore.list(guild.id).filter((id) => guild.channels.cache.has(id)).length;
    const noms = allModCommandNames();
    const listPages = Math.max(1, Math.ceil(noms.length / CMDS_PAR_PAGE));
    const listPage = Math.min(Math.max(0, Number(state.permCmdListPage) || 0), listPages - 1);

    // --- Texte des 4 sections, toujours visible en entier ---
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "**Permissions**",
          "Vous pouvez configurer les permissions (1-9)",
          "",
          "**Cooldowns**",
          `Page ${listPage + 1}/${listPages}`,
          "",
          "**Permissions supplémentaires**",
          "Donnez un accès direct à certaines commandes",
          "",
          "**Salons bloqués**",
          nbBloques ? `${nbBloques} salon(s) bloqué(s)` : "Aucun salon bloqué",
        ].join("\n")
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    // --- Section "Permissions" : bouton d'entrée, puis (si ouverte) son
    // sélecteur de niveau et, niveau choisi, rôles d'accès + commandes ---
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:permtoggleopen`).setLabel("Permissions").setStyle(ButtonStyle.Secondary)
      )
    );
    if (state.permOpen) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:permlevel`)
            .setPlaceholder("Choisir une permission (niveau)")
            .addOptions(
              Array.from({ length: LEVEL_MAX - LEVEL_MIN + 1 }, (_, i) => LEVEL_MIN + i).map((n) =>
                new StringSelectMenuOptionBuilder().setLabel(`Niveau ${n}`).setValue(String(n)).setDefault(n === niveau)
              )
            )
        )
      );
      if (niveau) {
        const roleIds = levelStore.listRoleLevels(guild.id).filter(([, lvl]) => lvl === niveau).map(([id]) => id);
        const rolesValides = roleIds.filter((id) => guild.roles.cache.has(id));
        const granted = keysForLevel(niveau);
        const commandes = commandsForKeys(granted);
        const pages = Math.max(1, Math.ceil(commandes.length / CMDS_PAR_PAGE));
        const page = Math.min(Math.max(0, Number(state.permCmdPage) || 0), pages - 1);

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**Rôles d'accès** — ${rolesValides.length} rôle(s) configuré(s)`)
        );
        if (peutModifier) {
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new RoleSelectMenuBuilder().setCustomId(`${ID}:permlevelrole:${niveau}`).setPlaceholder("Ajouter ou retirer un rôle")
            )
          );
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Commandes** — page ${page + 1}/${pages}`));
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ID}:permcmdpage:${page - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(page === 0 || pages <= 1),
            new ButtonBuilder().setCustomId(`${ID}:permcmdpage:${page + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1 || pages <= 1)
          )
        );
      }
      if (can(member, "sys")) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`${ID}:rolepresets`)
              .setPlaceholder("Provisionnement en masse")
              .addOptions(
                new StringSelectMenuOptionBuilder().setLabel("Créer les rôles").setValue("create").setDescription(`Crée les ${rolePresets.TOTAL_ROLES} rôles prédéfinis`),
                new StringSelectMenuOptionBuilder().setLabel("Supprimer les rôles").setValue("deleteall").setDescription("Supprime TOUS les rôles du serveur")
              )
          )
        );
      }
      if (can(member, "panel.permissions.manage")) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ID}:pruneroles`).setLabel("Nettoyer les rôles supprimés").setStyle(ButtonStyle.Secondary)
          )
        );
      }
    }
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    // --- Section "Cooldowns" ---
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:permcmdname:cooldowns`)
          .setPlaceholder(`Choisir une commande — page ${listPage + 1}/${listPages}`)
          .addOptions(
            noms.slice(listPage * CMDS_PAR_PAGE, (listPage + 1) * CMDS_PAR_PAGE).map((n) =>
              new StringSelectMenuOptionBuilder().setLabel(n).setValue(n).setDefault(n === state.permCmdNameCooldown)
            )
          )
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:permcmdlistpage:${listPage - 1}`).setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled(listPage === 0 || listPages <= 1),
        new ButtonBuilder().setCustomId(`${ID}:permcmdlistpage:${listPage + 1}`).setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled(listPage >= listPages - 1 || listPages <= 1)
      )
    );
    if (state.permCmdNameCooldown) {
      const rule = commandRules.getRule(guild.id, state.permCmdNameCooldown);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**Cooldown de \`${state.permCmdNameCooldown}\`** : ${rule.cooldownSeconds ? `${rule.cooldownSeconds}s` : "*aucun*"}`
        )
      );
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:cmdcooldownbtn:${state.permCmdNameCooldown}`)
            .setLabel(rule.cooldownSeconds ? "Modifier le cooldown" : "Définir un cooldown")
            .setStyle(ButtonStyle.Secondary),
          ...(rule.cooldownSeconds
            ? [new ButtonBuilder().setCustomId(`${ID}:cmdcooldownclear:${state.permCmdNameCooldown}`).setLabel("Retirer").setStyle(ButtonStyle.Danger)]
            : [])
        )
      );
    }
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    // --- Section "Permissions supplémentaires" ---
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:permcmdname:extra`)
          .setPlaceholder(`Choisir une configuration — page ${listPage + 1}/${listPages}`)
          .addOptions(
            noms.slice(listPage * CMDS_PAR_PAGE, (listPage + 1) * CMDS_PAR_PAGE).map((n) =>
              new StringSelectMenuOptionBuilder().setLabel(n).setValue(n).setDefault(n === state.permCmdNameExtra)
            )
          )
      )
    );
    if (state.permCmdNameExtra) {
      const rule = commandRules.getRule(guild.id, state.permCmdNameExtra);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**Accès direct à \`${state.permCmdNameExtra}\`** — rôles : ${rule.allowedRoles.length}, membres : ${rule.allowedUsers.length}`
        )
      );
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`${ID}:cmdallowrole:${state.permCmdNameExtra}`).setPlaceholder("Ajouter/retirer un rôle autorisé"))
      );
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:cmdallowuser:${state.permCmdNameExtra}`).setPlaceholder("Ajouter/retirer un membre autorisé"))
      );
    }
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    // --- Section "Salons bloqués" ---
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId(`${ID}:blockedchanneltoggle`).setPlaceholder("Configurer les salons bloqués")
      )
    );
  } else if (meta.key === "logs") {
    if (can(member, "logs.manage")) {
      if (!state.logsCategory) {
        addCards(
          container,
          Object.entries(LOG_CATEGORY_LABELS).map(([key, label]) => ({
            title: label,
            customId: `${ID}:logcatview:${key}`,
            label: "Configurer le salon",
          }))
        );
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ID}:logauto`).setLabel("Créer les salons automatiquement").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${ID}:logdelete`).setLabel("Supprimer les salons de logs").setStyle(ButtonStyle.Danger)
          )
        );
      } else {
        addBackButton(container, `${ID}:logcatview:`);
        const channels = getAllLogChannels(guild.id);
        const select = new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:logchannel:${state.logsCategory}`)
          .setPlaceholder(`Salon pour ${LOG_CATEGORY_LABELS[state.logsCategory]}`)
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1);
        if (channels[state.logsCategory]) select.setDefaultChannels(channels[state.logsCategory]);
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
      }
    }
  } else if (meta.key === "channels") {
    const choisis = selectionSalons(guild.id, member.id).filter((id) => guild.channels.cache.has(id));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:channelsdelpick`)
          .setPlaceholder("Choisir les salons à supprimer")
          // Toutes les sortes de salon : il n'y a aucune raison de pouvoir
          // nettoyer les salons textuels et pas les vocaux ou les catégories.
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultChannels(choisis)
      )
    );
    if (choisis.length) {
      // Bouton distinct, et non une suppression dès le choix : c'est la seule
      // action irréversible du panel, et un menu à sélection multiple se
      // manipule par petites touches — un clic de trop détruirait des salons
      // que personne n'avait décidé de perdre.
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:channelsdelgo`)
            .setLabel(`Supprimer ${choisis.length} salon(s)`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${ID}:channelsdelclear`).setLabel("Vider la sélection").setStyle(ButtonStyle.Secondary)
        )
      );
    }
  } else if (meta.key === "welcome") {
    const config = welcomeStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:welcomechannel`)
          .setPlaceholder("Envoyer le message de bienvenue à ce salon")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(config.channelId ? [config.channelId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:welcomedelete`)
          .setPlaceholder("Suppression automatique")
          .addOptions(
            WELCOME_DELETE_OPTIONS.map((opt) =>
              new StringSelectMenuOptionBuilder().setLabel(opt.label).setValue(String(opt.seconds)).setDefault(config.autoDeleteSeconds === opt.seconds)
            )
          )
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:welcomeadd`).setLabel("Ajouter un message").setStyle(ButtonStyle.Secondary)
      )
    );
    if (config.messages.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:welcomedel`)
            .setPlaceholder("Retirer un message")
            .addOptions(
              config.messages.map((m, i) => new StringSelectMenuOptionBuilder().setLabel(`${i + 1}. ${m}`.slice(0, 100)).setValue(String(i)))
            )
        )
      );
    }
  } else if (meta.key === "leave") {
    const config = leaveStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:leavechannel`)
          .setPlaceholder("Envoyer le message de départ à ce salon")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(config.channelId ? [config.channelId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:leavedelete`)
          .setPlaceholder("Suppression automatique")
          .addOptions(
            WELCOME_DELETE_OPTIONS.map((opt) =>
              new StringSelectMenuOptionBuilder().setLabel(opt.label).setValue(String(opt.seconds)).setDefault(config.autoDeleteSeconds === opt.seconds)
            )
          )
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:leaveadd`).setLabel("Ajouter un message").setStyle(ButtonStyle.Secondary)
      )
    );
    if (config.messages.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:leavedel`)
            .setPlaceholder("Retirer un message")
            .addOptions(
              config.messages.map((m, i) => new StringSelectMenuOptionBuilder().setLabel(`${i + 1}. ${m}`.slice(0, 100)).setValue(String(i)))
            )
        )
      );
    }
  } else if (meta.key === "autorole") {
    const roleIds = autoroleStore.getRoleIds(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:autoroleset`)
          .setPlaceholder("Choisir les rôles donnés à l'arrivée")
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultRoles(roleIds.filter((id) => guild.roles.cache.has(id)))
      )
    );
  } else if (meta.key === "verification") {
    const config = verificationStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:verifyrole`)
          .setPlaceholder("Rôle donné une fois vérifié")
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultRoles(config.roleId && guild.roles.cache.has(config.roleId) ? [config.roleId] : [])
      )
    );
    if (config.roleId) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:verifypost`)
            .setLabel("Poster le bouton dans ce salon")
            .setStyle(ButtonStyle.Success)
        )
      );
    }
  } else if (meta.key === "access") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:access:sweep`).setLabel("Nettoyer les accès obsolètes").setStyle(ButtonStyle.Danger)
      )
    );
  } else if (meta.key === "sys") {
    for (const row of accessRows("sys", "rang sys")) container.addActionRowComponents(row);
  } else if (meta.key === "banall") {
    for (const row of accessRows("banall", "ban de masse")) container.addActionRowComponents(row);
  } else if (meta.key === "tickets") {
    const config = ticketStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:ticketstaff`)
          .setPlaceholder("Rôle qui voit les tickets (vide = aucun)")
          .setMinValues(0)
          .setDefaultRoles(config.staffRoleId && guild.roles.cache.has(config.staffRoleId) ? [config.staffRoleId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:ticketclose`)
          .setPlaceholder("Rôle qui peut fermer (vide = le rôle staff)")
          .setMinValues(0)
          .setDefaultRoles(config.closeRoleId && guild.roles.cache.has(config.closeRoleId) ? [config.closeRoleId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:ticketcategory`)
          .setPlaceholder("Catégorie où créer les tickets (vide = racine)")
          .addChannelTypes(ChannelType.GuildCategory)
          .setMinValues(0)
          .setDefaultChannels(config.categoryId && guild.channels.cache.has(config.categoryId) ? [config.categoryId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        // Bascule encodée dans le customId : le libellé reflète ce que CE
        // rendu affiche, donc un clic fait toujours l'inverse.
        new ButtonBuilder()
          .setCustomId(`${ID}:ticketownerclose:${config.ownerCanClose ? "off" : "on"}`)
          .setLabel(config.ownerCanClose ? "Interdire au demandeur de fermer" : "Autoriser le demandeur à fermer")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "confessions") {
    if (can(member, "server.confessions.setup")) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder().setCustomId(`${ID}:confesschannel`).setPlaceholder("Salon public des confessions")
        )
      );
    }
    if (can(member, "server.confessions.validation")) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder().setCustomId(`${ID}:confessvalidation`).setPlaceholder("Salon de validation (staff)")
        )
      );
    }
  } else if (meta.key === "giveaways") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:giveawaystart`).setLabel("Démarrer un giveaway").setStyle(ButtonStyle.Success)
      )
    );
    const active = giveawayStore
      .listForGuild(guild.id)
      .filter((g) => !g.ended)
      .sort((a, b) => a.endsAt - b.endsAt)
      .slice(0, 5);
    if (active.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:giveawaypick`)
            .setPlaceholder("Choisir un giveaway en cours")
            .addOptions(
              active.map((g) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(g.prize.slice(0, 100))
                  .setDescription(`Se termine le ${new Date(g.endsAt).toLocaleString("fr-FR")}`.slice(0, 100))
                  .setValue(g.messageId)
                  .setDefault(g.messageId === state.giveawaySelected)
              )
            )
        )
      );
      if (state.giveawaySelected && active.some((g) => g.messageId === state.giveawaySelected)) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${ID}:giveawayend:${state.giveawaySelected}`)
              .setLabel("Terminer maintenant")
              .setStyle(ButtonStyle.Danger)
              ,
            new ButtonBuilder()
              .setCustomId(`${ID}:giveawayreroll:${state.giveawaySelected}`)
              .setLabel("Retirer un gagnant (reroll)")
              .setStyle(ButtonStyle.Secondary)
          )
        );
      }
    }
  } else if (meta.key === "embedBuilder") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:embedbuild`).setLabel("Construire un embed").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "polls") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:pollstart`).setLabel("Créer un sondage").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "backups") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:backupsavebtn`).setLabel("Sauvegarder ce serveur").setStyle(ButtonStyle.Success)
      )
    );
    const saved = backupStore.listBackups().map((b) => b.name);
    const all = [...Object.keys(PRESET_BACKUPS), ...saved];
    if (all.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:backuppick`)
            .setPlaceholder("Choisir une sauvegarde")
            .addOptions(
              all.slice(0, 25).map((name) =>
                new StringSelectMenuOptionBuilder().setLabel(name).setValue(name).setDefault(name === state.backupSelected)
              )
            )
        )
      );
      if (state.backupSelected && all.includes(state.backupSelected)) {
        const isPresetOnly = PRESET_BACKUPS[state.backupSelected.toLowerCase()] && !backupStore.getBackup(state.backupSelected);
        const boutons = [
          new ButtonBuilder()
            .setCustomId(`${ID}:backuprestore:${state.backupSelected}`)
            .setLabel("Restaurer (double confirmation)")
            .setStyle(ButtonStyle.Danger)
            ,
        ];
        if (!isPresetOnly) {
          boutons.push(
            new ButtonBuilder()
              .setCustomId(`${ID}:backupdelete:${state.backupSelected}`)
              .setLabel("Supprimer")
              .setStyle(ButtonStyle.Secondary)
          );
        }
        container.addActionRowComponents(new ActionRowBuilder().addComponents(...boutons));
      }
    }
  } else if (meta.key === "botProfile") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:botstatus`)
          .setPlaceholder("Changer le statut")
          .addOptions(
            Object.entries(STATUS_LABELS).map(([value, label]) =>
              new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setDefault(value === botProfileStore.getConfig().status)
            )
          )
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:botnamebtn`).setLabel("Changer le nom").setStyle(ButtonStyle.Secondary)
      )
    );
  }

  // Dernière étape du rendu : les boutons d'action deviennent un seul menu.
  // "Rôles (paliers)" garde ses VRAIS boutons : ils sont attachés à une ligne
  // précise (« Permission 3 : @rôle » + Supprimer/Ajouter/Renommer), ce qu'un
  // menu unique ne sait pas rendre — il les fondrait tous ensemble et on ne
  // saurait plus quel palier chaque action vise. C'est l'exception assumée à
  // la règle « les actions passent dans un menu déroulant ».
  if (meta.key !== "permissions" && meta.key !== "logs") regrouperBoutonsEnMenu(container);

  return { flags: MessageFlags.IsComponentsV2, components: [container], ...(fichiers.length ? { files: fichiers } : {}) };
}

const PREFIX_FIELDS = {
  musicMod: { label: "Préfixe gestion", max: 3 },
};

/**
 * Traite toutes les interactions du panneau (identifiants en "cfg:"). Les
 * droits sont re-vérifiés à CHAQUE clic — le message reste visible dans le
 * salon après l'envoi, n'importe qui pourrait cliquer dessus.
 */
async function handleConfigInteraction(interaction, customIdImpose) {
  // `customIdImpose` sert au menu d'actions : la valeur choisie EST le
  // customId du bouton d'origine, et on réexpédie vers son handler sans avoir
  // à cloner l'interaction (un clone casserait les méthodes de discord.js).
  const identifiant = customIdImpose || interaction.customId;
  const [, action, extra, extra2] = identifiant.split(":");
  const member = interaction.member;

  if (!hasAnyPanelAccess(member)) {
    return interaction.reply({ content: "Tu n'as pas accès à ce panneau.", flags: MessageFlags.Ephemeral });
  }

  // Menu d'actions : la valeur choisie est le customId du bouton d'origine.
  // Une seule redirection possible — la valeur ne peut pas être un autre
  // "cfg:action", donc pas de récursion sans fin.
  if (action === "action") {
    const choisi = interaction.values?.[0];
    if (!choisi || choisi.startsWith(`${ID}:action`)) return undefined;
    return handleConfigInteraction(interaction, choisi);
  }

  const guild = interaction.guild;
  const guildId = guild.id;
  const isOwner = accessStore.isOwner(member.id);

  // `attachments: []` à CHAQUE édition : le panel est un message unique édité
  // en place, et certains écrans portent une image (tableau de bord de
  // l'accueil, fiche membre). Sans ce champ, Discord conserve les pièces
  // jointes précédentes et le message accumule une image de plus à chaque
  // clic — y compris en revenant sur un écran qui n'en a aucune.
  // Une édition refusée (pièce jointe interdite dans le salon, écran à image)
  // laissait le clic sans réponse — « Échec de l'interaction », panel figé sur
  // l'écran précédent. On rejoue alors le même écran en texte, comme le fait
  // le premier envoi (utils/musicCommands.js::repondreAvecTableauDeBord).
  const editer = (section, state, sansImage) =>
    interaction.update({ ...buildConfigPanel(guild, section, member, state, { sansImage }), attachments: [] });
  const goto = (section, state) =>
    editer(section, state, false).catch((err) => {
      console.error("[configPanel] interaction.update a échoué :", err);
      return editer(section, state, true).catch((err2) => console.error("[configPanel] repli texte refusé lui aussi :", err2));
    });

  if (action === "nav") {
    // Le bouton de navigation donne une famille (clé dans le customId,
    // "cfg:nav:<clé>" — plus un menu déroulant) : on ouvre sa première
    // rubrique accessible, celle qui a le plus de chances d'être celle
    // qu'on cherche.
    const famille = FAMILIES.find((f) => f.key === (interaction.values?.[0] || extra));
    const rubriques = famille ? familySections(famille, member, isOwner) : [];
    return goto(rubriques[0]?.key || "home");
  }

  if (action === "subnav") {
    return goto(interaction.values[0]);
  }

  if (action === "confesschannel") {
    if (!can(member, "server.confessions.setup")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    confessStore.setChannel(guildId, interaction.values[0]);
    const salon = guild.channels.cache.get(interaction.values[0]);
    if (salon?.isTextBased?.()) await salon.send(buildConfessCard()).catch(() => {});
    return goto("confessions", {});
  }

  if (action === "confessvalidation") {
    if (!can(member, "server.confessions.validation")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    confessStore.setValidationChannel(guildId, interaction.values[0]);
    return goto("confessions", {});
  }

  // "Permissions" (grande carte unique) n'a pas de state persistant côté
  // serveur : on relit l'état actuel depuis le message affiché (voir
  // lireStatePermissions) pour que chaque clic ne modifie QUE la section
  // visée sans réinitialiser les autres (niveau ouvert, commande choisie
  // dans Cooldowns/Permissions supplémentaires, page en cours).
  const state = lireStatePermissions(interaction.message);

  if (action === "cmdallowrole") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    commandRules.toggleAllowedRole(guildId, extra, interaction.values[0]);
    return goto("permissions", { ...state, permCmdNameExtra: extra });
  }

  if (action === "cmdallowuser") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    commandRules.toggleAllowedUser(guildId, extra, interaction.values[0]);
    return goto("permissions", { ...state, permCmdNameExtra: extra });
  }

  if (action === "cmdcooldownbtn") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const texte = interaction.fields.getTextInputValue("secondes").trim();
      const secondes = texte === "" ? 0 : parseInt(texte, 10);
      if (Number.isNaN(secondes) || secondes < 0) {
        return interaction.reply({ content: "Indique un nombre de secondes valide (0 ou vide pour retirer le cooldown).", flags: MessageFlags.Ephemeral });
      }
      commandRules.setCooldown(guildId, extra, secondes);
      return goto("permissions", { ...state, permCmdNameCooldown: extra });
    }
    const rule = commandRules.getRule(guildId, extra);
    const modal = new ModalBuilder().setCustomId(`${ID}:cmdcooldownbtn:${extra}`).setTitle("Cooldown de la commande");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("secondes")
          .setLabel("Secondes entre deux usages par membre (0 = aucun)")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(6)
          .setRequired(false)
          .setValue(rule.cooldownSeconds ? String(rule.cooldownSeconds) : "")
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "cmdcooldownclear") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    commandRules.setCooldown(guildId, extra, null);
    return goto("permissions", { ...state, permCmdNameCooldown: extra });
  }

  // Bouton "Permissions" de la grande carte unique : ouvre/ferme ses
  // contrôles (sélecteur de niveau, etc.) SANS jamais masquer le reste de la
  // carte (Cooldowns/Permissions supplémentaires/Salons bloqués restent
  // affichés en dessous, comme sur le screen de référence).
  if (action === "permtoggleopen") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { ...state, permOpen: !state.permOpen });
  }

  // Choisir un niveau (1-9) dans la section "Permissions".
  if (action === "permlevel") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { ...state, permOpen: true, permLevel: parseInt(interaction.values[0], 10) });
  }

  // Rôle d'accès ajouté/retiré à CE niveau — action d'escalade potentielle,
  // réservée au propriétaire du bot (jamais déléguée au rang sys).
  if (action === "permlevelrole") {
    if (!peutGererNiveaux(member)) return interaction.reply({ content: "Réservé au propriétaire du bot.", flags: MessageFlags.Ephemeral });
    const niveau = parseInt(extra, 10);
    if (!Number.isInteger(niveau) || niveau < LEVEL_MIN || niveau > LEVEL_MAX) {
      return interaction.reply({ content: "Niveau invalide.", flags: MessageFlags.Ephemeral });
    }
    const roleId = interaction.values[0];
    const niveauActuel = levelStore.getRoleLevel(guildId, roleId);
    levelStore.setRoleLevel(guildId, roleId, niveauActuel === niveau ? null : niveau);
    return goto("permissions", { ...state, permOpen: true, permLevel: niveau });
  }

  // Pagination des commandes débloquées à ce niveau.
  if (action === "permcmdpage") {
    return goto("permissions", { ...state, permOpen: true, permCmdPage: Number(extra) || 0 });
  }

  // Pagination du sélecteur de commande partagé par "Cooldowns"/"Permissions
  // supplémentaires" (même liste, même page pour les deux sections).
  if (action === "permcmdlistpage") {
    return goto("permissions", { ...state, permCmdListPage: Number(extra) || 0 });
  }

  // Commande choisie dans le sélecteur paginé de "Cooldowns" ou "Permissions
  // supplémentaires" — extra distingue la section d'origine.
  if (action === "permcmdname") {
    if (extra === "cooldowns") return goto("permissions", { ...state, permCmdNameCooldown: interaction.values[0] });
    if (extra === "extra") return goto("permissions", { ...state, permCmdNameExtra: interaction.values[0] });
    return undefined;
  }

  // Section "Salons bloqués" : toggle direct sur le(s) salon(s) choisi(s) —
  // même store que le check en tête de dispatch (musicCommands.js), bypass
  // owner/rang sys inconditionnel.
  if (action === "blockedchanneltoggle") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    for (const channelId of interaction.values) blockedChannelsStore.toggle(guildId, channelId);
    return goto("permissions", { ...state });
  }

  if (action === "pruneroles") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const removed = pruneDeletedRoles(guild);
    const texte = removed.length
      ? `**${removed.length}** octroi(s) de rôle supprimé retiré(s).`
      : "Rien à nettoyer, tous les rôles avec des permissions accordées existent encore.";
    // Retour sur "permissions" (où vit le bouton), pas une carte isolée sans
    // retour possible — même correctif que rolecreate/renamerole/roledelete.
    const panel = buildConfigPanel(guild, "permissions", member, { ...state, permOpen: true }, {});
    return interaction.update(banniereSurPanel(panel, texte));
  }

  // Provisionnement en masse (utils/rolePresets.js) — voir le sélecteur dans
  // la vue "Permissions". Passe par messageFromInteraction comme le reste
  // des commandes admin du panel : la confirmation ET son exécution
  // remplacent le panel en place, jamais un second message à côté.
  if (action === "rolepresets") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const choix = interaction.values[0];
    if (choix === "create") return rolePresets.createPresetRoles(interaction.client, messageFromInteraction(interaction, { section: "permissions" }));
    if (choix === "deleteall") return rolePresets.deleteAllRoles(interaction.client, messageFromInteraction(interaction, { section: "permissions" }));
    return;
  }

  // Giveaways : démarrer réutilise la carte de formulaire existante
  // (utils/commandForms.js::FORMS.giveaway_start, celle que &giveaway ouvre
  // déjà bare) ; terminer/reroll appellent directement utils/giveaways.js
  // avec l'ID du message ciblé, jamais un second tirage réimplémenté.
  if (action === "giveawaystart") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return interaction.reply(buildFormCard("giveaway_start", member));
  }

  if (action === "giveawaypick") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("giveaways", { giveawaySelected: interaction.values[0] || null });
  }

  if (action === "giveawayend" || action === "giveawayreroll") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const messageId = extra;
    const giveaway = giveawayStore.get(messageId);
    await goto("giveaways", { giveawaySelected: null });
    const channel = giveaway && guild.channels.cache.get(giveaway.channelId);
    if (!channel) return;
    const msg = fakeMessage(interaction, { channel });
    if (action === "giveawayend") await endGiveaway(interaction.client, msg, [messageId]);
    else await rerollGiveaway(interaction.client, msg, [messageId]);
    return;
  }

  // Communication : le bouton ouvre EXACTEMENT ce que &embed/&poll ouvrent
  // déjà (modale / carte de formulaire) — aucune deuxième implémentation.
  if (action === "embedbuild") {
    return handleEmbedButton(interaction);
  }

  if (action === "pollstart") {
    if (!can(member, "server.polls.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return interaction.reply(buildFormCard("poll_create", member));
  }

  // Sauvegardes : réutilise TEL QUEL &backup (utils/serverBackup.js) — un
  // seul dispatcher pour créer/supprimer/restaurer, jamais une deuxième
  // implémentation. `messageFromInteraction` sert d'accusé de réception
  // (sa .reply() = interaction.reply(), même mécanisme que rolecreate un peu
  // plus haut) : le message de confirmation vient donc directement de
  // &backup lui-même. Restaurer passe doubleConfirm:true — amélioration
  // demandée explicitement pour le panel, où un clic est plus facile qu'en
  // tapant la commande.
  if (action === "backupsavebtn") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rien n'a été sauvegardé.", flags: MessageFlags.Ephemeral });
      await backup(interaction.client, messageFromInteraction(interaction, { section: "backups" }), [name]);
      return;
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:backupsavebtn`).setTitle("Sauvegarder ce serveur");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nom de la sauvegarde").setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "backuppick") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("backups", { backupSelected: interaction.values[0] || null });
  }

  if (action === "backupdelete") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await backup(interaction.client, messageFromInteraction(interaction, { section: "backups" }), ["delete", extra]);
    return;
  }

  if (action === "backuprestore") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await backup(interaction.client, messageFromInteraction(interaction, { section: "backups" }), ["load", extra], { doubleConfirm: true });
    return;
  }

  // Profil du bot : réutilise TEL QUEL utils/botProfileCommands.js — même
  // remarque que ci-dessus, aucune deuxième implémentation.
  if (action === "botstatus") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const fn = botProfileHandlers[interaction.values[0]];
    if (!fn) return;
    await fn(interaction.client, messageFromInteraction(interaction, { section: "botProfile" }));
    return;
  }

  if (action === "botnamebtn") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rien n'a changé.", flags: MessageFlags.Ephemeral });
      await botProfileHandlers.set(interaction.client, messageFromInteraction(interaction, { section: "botProfile" }), ["name", name]);
      return;
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:botnamebtn`).setTitle("Changer le nom du bot");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "logcatview") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("logs", { logsCategory: extra || null });
  }

  if (action === "logchannel") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    setLogChannelId(guildId, extra, interaction.values[0] || null);
    return goto("logs", { logsCategory: extra });
  }

  if (action === "logauto") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const botPerm = checkBotPermission(guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
    if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

    const { created } = await createLogChannelsAutomatically(guild);
    await interaction.reply({
      content: created.length
        ? `${created.length} salon(s) créé(s) : ${created.map((c) => `<#${c.channel.id}>`).join(", ")}.`
        : "Toutes les catégories ont déjà un salon configuré, rien à créer.",
      flags: MessageFlags.Ephemeral,
    });
    return goto("logs");
  }

  if (action === "logdelete") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const botPerm = checkBotPermission(guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
    if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

    const { deleted } = await deleteLogChannelsAutomatically(guild);
    await interaction.reply({
      content: deleted.length
        ? `${deleted.length} salon(s) de logs supprimé(s). Utilise "Créer les salons automatiquement" pour les recréer.`
        : "Aucun salon de logs configuré, rien à supprimer.",
      flags: MessageFlags.Ephemeral,
    });
    return goto("logs");
  }

  // Centre de modération : chercher un membre, puis agir sur sa fiche.
  // MODÉRATION RETIRÉE DU PANEL, volontairement : plus de recherche de membre,
  // plus de boutons Warn/Timeout/Kick/Ban ni d'ajout de rôle ici. Le panel
  // sert à la sécurité, aux outils et à la gestion du serveur ; sanctionner
  // ou donner un rôle se fait par commande, avec une mention ou un
  // identifiant. L'historique de modération (rubrique "Historique") a lui
  // aussi été retiré du panel : il vit désormais sur le bot de modération
  // séparé (moderation-bot).

  // --- Rubrique "Salons" : suppression groupée ---
  if (action === "channelsdelpick" || action === "channelsdelclear" || action === "channelsdelgo") {
    if (!can(member, "channels.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }

    if (action === "channelsdelpick") {
      // Un menu à sélection multiple renvoie l'état COMPLET des cases cochées,
      // pas la différence : on remplace donc, sinon décocher n'aurait aucun
      // effet et la liste ne ferait que grossir.
      definirSelectionSalons(guildId, member.id, interaction.values || []);
      return goto("channels");
    }

    if (action === "channelsdelclear") {
      definirSelectionSalons(guildId, member.id, []);
      return goto("channels");
    }

    const choisis = selectionSalons(guildId, member.id);
    if (!choisis.length) return goto("channels");

    const supprimes = [];
    const refuses = [];
    for (const id of choisis) {
      const salon = guild.channels.cache.get(id);
      if (!salon) continue; // déjà supprimé entre-temps
      // Le salon qui PORTE le panel est écarté : le supprimer ferait échouer
      // la mise à jour du message juste après, et le compte-rendu de ce qui a
      // été détruit serait perdu avec lui.
      if (id === interaction.channelId) {
        refuses.push(`${salon.name} (c'est le salon où tu es)`);
        continue;
      }
      if (!salon.deletable) {
        refuses.push(`${salon.name} (droits insuffisants)`);
        continue;
      }
      try {
        await salon.delete(`Suppression groupée depuis le panel par ${interaction.user.tag}`);
        supprimes.push(salon.name);
      } catch (err) {
        refuses.push(`${salon.name} (${err.message})`);
      }
    }
    definirSelectionSalons(guildId, member.id, []);

    // Le compte-rendu part en éphémère : la rubrique elle-même se recharge
    // derrière, et l'écrire dans le panel le ferait disparaître au clic
    // suivant, avant même d'avoir pu le lire.
    const lignes = [];
    if (supprimes.length) lignes.push(`**${supprimes.length} salon(s) supprimé(s)** : ${supprimes.join(", ")}`);
    if (refuses.length) lignes.push(`**${refuses.length} conservé(s)** : ${refuses.join(", ")}`);
    await interaction.reply({ content: lignes.join("\n") || "Aucun salon à supprimer.", flags: MessageFlags.Ephemeral }).catch(() => {});
    // `goto` a déjà répondu via `reply` : on édite donc le message du panel
    // directement pour le remettre à jour.
    return interaction.message?.edit({ ...buildConfigPanel(guild, "channels", member), attachments: [] }).catch(() => {});
  }

  if (action === "welcomechannel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    welcomeStore.setChannel(guildId, interaction.values[0] || null);
    return goto("welcome");
  }

  if (action === "welcomedelete") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    welcomeStore.setAutoDelete(guildId, parseInt(interaction.values[0], 10) || 0);
    return goto("welcome");
  }

  if (action === "welcomedel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    welcomeStore.removeMessage(guildId, parseInt(interaction.values[0], 10));
    return goto("welcome");
  }

  if (action === "welcomeadd") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const text = interaction.fields.getTextInputValue("value").trim();
      if (!text) return interaction.reply({ content: "Message vide, rien n'a été ajouté.", flags: MessageFlags.Ephemeral });
      welcomeStore.addMessage(guildId, text);
      await interaction.reply({ content: "Message de bienvenue ajouté.", flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "welcome", member)).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:welcomeadd`).setTitle("Ajouter un message de bienvenue");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel("Message (tiré au hasard à l'arrivée)")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "leavechannel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    leaveStore.setChannel(guildId, interaction.values[0] || null);
    return goto("leave");
  }

  if (action === "leavedelete") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    leaveStore.setAutoDelete(guildId, parseInt(interaction.values[0], 10) || 0);
    return goto("leave");
  }

  if (action === "leavedel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    leaveStore.removeMessage(guildId, parseInt(interaction.values[0], 10));
    return goto("leave");
  }

  if (action === "leaveadd") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const text = interaction.fields.getTextInputValue("value").trim();
      if (!text) return interaction.reply({ content: "Message vide, rien n'a été ajouté.", flags: MessageFlags.Ephemeral });
      leaveStore.addMessage(guildId, text);
      await interaction.reply({ content: "Message de départ ajouté.", flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "leave", member)).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:leaveadd`).setTitle("Ajouter un message de départ");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel('Message ("{user}" = pseudo de la personne)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "autoroleset") {
    if (!can(member, "members.autorole.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    autoroleStore.setRoleIds(guildId, interaction.values);
    return goto("autorole");
  }

  if (action === "verifyrole") {
    if (!can(member, "members.verification.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    verificationStore.setRole(guildId, interaction.values[0] || null);
    return goto("verification");
  }

  if (action === "verifypost") {
    if (!can(member, "members.verification.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const config = verificationStore.getConfig(guildId);
    if (!config.roleId || !guild.roles.cache.has(config.roleId)) {
      return interaction.reply({ content: "Choisis d'abord un rôle valide.", flags: MessageFlags.Ephemeral });
    }
    verificationStore.setChannel(guildId, interaction.channel.id);
    const verifyContainer = new ContainerBuilder();
    verifyContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Vérification\nClique ci-dessous pour accéder au reste du serveur.")
    );
    verifyContainer.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("verify:claim").setLabel("Se vérifier").setStyle(ButtonStyle.Success)
      )
    );
    await interaction.channel.send({ flags: MessageFlags.IsComponentsV2, components: [verifyContainer] });
    await interaction.reply({ content: "Message de vérification envoyé dans ce salon.", flags: MessageFlags.Ephemeral });
    return goto("verification");
  }

  if (action === "access" && extra === "sweep") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const revoked = sweepGuild(interaction.client, guild);
    await interaction.reply({
      content: revoked.length ? `${revoked.length} accès obsolète(s) révoqué(s).` : "Rien à nettoyer, tout est à jour.",
      flags: MessageFlags.Ephemeral,
    });
    return goto("access");
  }

  if (action === "add" || action === "del") {
    if (extra === "sys" && !isOwner) {
      return interaction.reply({
        content: "Seul le propriétaire du bot peut accorder le rang sys.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.values[0];
    if (accessStore.isOwner(userId)) {
      return interaction.reply({
        content: `<@${userId}> est propriétaire du bot, il a déjà tous les accès.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const changed = action === "add" ? accessStore.add(extra, userId) : accessStore.remove(extra, userId);
    if (!changed) {
      return interaction.reply({
        content: action === "add" ? `<@${userId}> y était déjà.` : `<@${userId}> n'y était pas.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return goto(SECTION_OF_SCOPE[extra] || "home");
  }

  if (action === "ticketstaff") {
    if (!can(member, "server.tickets.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    ticketStore.setStaffRole(guildId, interaction.values[0] || null);
    return goto("tickets");
  }

  // Rôle autorisé à FERMER, distinct de celui qui voit les tickets. Vide =
  // c'est le rôle staff qui ferme, comme avant l'ajout de ce réglage.
  if (action === "ticketclose") {
    if (!can(member, "server.tickets.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    ticketStore.setConfig(guildId, { closeRoleId: interaction.values[0] || null });
    return goto("tickets");
  }

  if (action === "ticketcategory") {
    if (!can(member, "server.tickets.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    ticketStore.setConfig(guildId, { categoryId: interaction.values[0] || null });
    return goto("tickets");
  }

  if (action === "ticketownerclose") {
    if (!can(member, "server.tickets.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    ticketStore.setConfig(guildId, { ownerCanClose: extra === "on" });
    return goto("tickets");
  }

  if (action === "prefix") {
    const field = PREFIX_FIELDS[extra];
    if (!field) return interaction.reply({ content: "Type de préfixe inconnu.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const value = interaction.fields.getTextInputValue("value").trim();
      if (!value) {
        return interaction.reply({ content: "Préfixe vide, rien n'a été changé.", flags: MessageFlags.Ephemeral });
      }
      if (value.length > 3 || /\s/.test(value)) {
        return interaction.reply({ content: "Un préfixe fait 3 caractères au maximum, sans espace.", flags: MessageFlags.Ephemeral });
      }
      const conflicts = prefixConflicts({ ...getPrefixes(guildId), [extra]: value });
      if (conflicts.length) {
        return interaction.reply({
          content: `Préfixe refusé : ${prefixConflictMessage(conflicts)}. Choisis un préfixe qui ne commence pas par un autre.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      setPrefix(guildId, extra, value);
      await interaction.reply({
        content: `**${PREFIX_FIELDS[extra].label}** réglé sur \`${value}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return interaction.message?.edit(buildConfigPanel(guild, "prefixes", member)).catch(() => {});
    }

    const modal = new ModalBuilder().setCustomId(interaction.customId).setTitle(field.label);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(field.label)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(field.max)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }
}

module.exports = {
  buildConfigPanel, buildSectionSpec, handleConfigInteraction, hasAnyPanelAccess, ID, SECTIONS };
