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
const { getPrefixes, setPrefix } = require("./prefixStore");
const { EMOJI } = require("./emojis");
const { rendreEnCache, resumer, enTexte, texteAlternatif } = require("./dashboardImage");
const sectionDashboard = require("./sectionDashboard");
const { rendreCarteActionSync, prechargerAvatar, avatarDe, nomDe } = require("./actionCard");
const accessStore = require("./accessStore");
const { can } = require("./permissions/engine");
const permCatalog = require("./permissions/catalog");
const permStore = require("./permissions/store");
const { commandsForKeys, nonCommandGrants, computeTiers } = require("./permsCommands");
const rolePresets = require("./rolePresets");
const { sweepGuild } = require("./permissions/cleanup");
const { checkBotPermission } = require("./moderation/actions");
const { getAllLogChannels, setLogChannelId, CATEGORY_LABELS: LOG_CATEGORY_LABELS } = require("./modLogStore");
const statsStore = require("./statsStore");
const { LOG_CHANNEL_NAMES, createLogChannelsAutomatically, deleteLogChannelsAutomatically } = require("./logChannels");
const historyStore = require("./moderationHistoryStore");
const leaveStore = require("./leaveStore");
const autoroleStore = require("./autoroleStore");
const verificationStore = require("./verificationStore");
const automod = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");
const welcomeStore = require("./welcomeStore");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const { ALL_GUARDS } = require("./guard/definitions");
const muteStore = require("./muteStore");
const ticketStore = require("./ticketStore");
const voiceChannels = require("./voiceChannels");
const voiceHubSetup = require("./voiceHubSetup");
const { roleAdmin } = require("./serverAdminCommands");
const { parseDuration } = require("./moderationCommands");
const { computeSecurityScan } = require("./securityScan");
const { computeStatus, formatUptime } = require("./statusDiagnostic");
const { FORMS, setFormState, buildFormCard } = require("./commandForms");
const { fakeMessage } = require("./fakeMessage");
const { utilityHandlers } = require("./utilityCommands");
const giveawayStore = require("./giveawayStore");
const { endGiveaway, rerollGiveaway } = require("./giveaways");
const { handleEmbedButton } = require("./serverExtra");
const { buildFavoritesPanel } = require("./favoritesPanel");
const { LOOP_LABELS } = require("./nowPlayingPanel");
const backupStore = require("./serverBackupStore");
const { backup, countChannels, PRESET_BACKUPS } = require("./serverBackup");
const botProfileStore = require("./botProfileStore");
const { botProfileHandlers, STATUS_LABELS } = require("./botProfileCommands");

// Même variable d'environnement que index.js/musicCommands.js — musique
// suspendue = rubrique Musique masquée du panel elle aussi (famille "musique"
// automatiquement retirée du menu, buildNav ne montrant déjà que les
// familles ayant au moins une rubrique visible).
const MUSIC_ENABLED = process.env.MUSIC_ENABLED !== "false";

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
  { key: "prefixes", label: "Préfixes", description: "Préfixe musique et préfixe des commandes", permission: "sys" },
  { key: "moderation", label: "Dispenses", description: "Qui échappe au quota de nettoyage", permission: "sys" },
  {
    key: "permissions",
    label: "Rôles et permissions",
    description: "Informations d'un rôle et permissions du bot qu'il accorde",
    // Consultable avec l'un OU l'autre droit ; seul panel.permissions.manage
    // fait apparaître les menus qui modifient.
    visible: (member) => can(member, "panel.permissions.manage") || can(member, "panel.roles.manage"),
  },
  {
    key: "roletiers",
    label: "Rôles (paliers)",
    description: "Tous les paliers de permissions et leurs rôles d'un coup (comme &perms + &helpall réunis)",
    permission: "panel.permissions.manage",
  },
  {
    key: "logs",
    label: "Logs",
    description: "Salon de logs par catégorie (modération/membres/serveur/bots)",
    visible: (member) => can(member, "logs.view") || can(member, "logs.manage"),
  },
  { key: "history", label: "Historique", description: "Rechercher dans l'historique de modération", permission: "logs.view" },
  { key: "stats", label: "Statistiques", description: "Compteurs serveur et activité des 7 derniers jours", permission: "server.stats.view" },
  { key: "diagnostics", label: "Diagnostics", description: "Uptime, latence, mémoire, nœuds Lavalink", permission: "sys" },
  {
    key: "securityOverview",
    label: "Vue d'ensemble",
    description: "État global : anti-spam, anti-nuke, mute, logs, permissions dangereuses",
    visible: (member) => can(member, "protection.automod") || can(member, "protection.guard.manage"),
  },
  { key: "protection", label: "Protection", description: "Anti-spam et whitelist", permission: "protection.automod" },
  { key: "guard", label: "Anti-nuke", description: "Détection de rafales destructrices et sanction automatique", permission: "protection.guard.manage" },
  { key: "welcome", label: "Bienvenue", description: "Message de bienvenue à l'arrivée d'un membre", permission: "server.welcome.manage" },
  { key: "leave", label: "Départ", description: "Message envoyé quand un membre quitte le serveur", permission: "server.welcome.manage" },
  { key: "autorole", label: "Rôles automatiques", description: "Rôles donnés automatiquement à l'arrivée", permission: "members.autorole.manage" },
  { key: "verification", label: "Vérification", description: "Rôle et salon du bouton \"Se vérifier\"", permission: "members.verification.manage" },
  { key: "mute", label: "Mute", description: "Rôle utilisé par &mute/&tempmute/&cmute", permission: "protection.automod" },
  { key: "tickets", label: "Tickets", description: "Rôle staff des tickets (voir &ticket setup)", permission: "server.tickets.manage" },
  { key: "voice", label: "Vocaux", description: "Salon générateur de vocaux temporaires (voir &voicehub)", permission: "server.voice.manage" },
  { key: "channels", label: "Salons", description: "Sélectionner plusieurs salons et les supprimer d'un coup", permission: "channels.manage" },
  { key: "giveaways", label: "Giveaways", description: "Giveaways en cours : démarrer, terminer, reroll", permission: "server.giveaways.manage" },
  { key: "embedBuilder", label: "Constructeur d'embed", description: "Composer et envoyer un embed dans un salon", permission: "server.channels.manage" },
  { key: "polls", label: "Sondages", description: "Créer un sondage (2 à 5 options)", permission: "server.polls.manage" },
  // Pas de `permission` : &play/&pause... ne sont pas gated par le moteur de
  // permissions (seule l'appartenance au même salon vocal compte, voir
  // index.js::canControlPlayer) — cette rubrique reste donc publique elle
  // aussi, comme les commandes qu'elle affiche/relie.
  { key: "musicPlayer", label: "Musique", description: "Lecteur en cours et favoris", enabled: MUSIC_ENABLED },
  { key: "access", label: "Accès panel", description: "Qui a accès, nettoyage des accès obsolètes", permission: "sys" },
  { key: "backups", label: "Sauvegardes", description: "Structure du serveur : créer, restaurer, supprimer", permission: "sys" },
  { key: "botProfile", label: "Profil du bot", description: "Statut et nom du bot (partagés sur tous les serveurs)", permission: "sys" },
  { key: "sys", label: "Rang sys", description: "Qui a accès à tout le bot", ownerOnly: true },
  { key: "banall", label: "Ban de masse", description: "Qui peut lancer un ban de masse", ownerOnly: true },
];

function sectionVisible(section, member, isOwner) {
  // Indépendant des droits : une rubrique dont la fonctionnalité sous-jacente
  // est globalement coupée (ex : musique suspendue) reste masquée pour tout
  // le monde, y compris le propriétaire — volontairement testé AVANT tout le
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
 * `permission`/`visible`/`ownerOnly` (Accueil, Musique — ni l'une ni l'autre
 * gated par le moteur de permissions, voir leurs commentaires dans SECTIONS)
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
// Communication/Musique/Monitoring/Sauvegardes/Bot), toutes présentes
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
// Plus AUCUNE couleur : demande explicite. Une seule teinte neutre sert de
// gris de tracé pour les liserés et les titres des images, de sorte que le
// rendu reste lisible sans rien colorer.
const TEINTE_NEUTRE = "#d0d0d0";

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
const FAMILY_COLORS = new Proxy({}, { get: () => TEINTE_NEUTRE });

// Le menu du panel liste des SUJETS CONCRETS — Logs, Bienvenue, Vocaux
// temporaires, Permissions, Giveaways — et non plus des familles abstraites
// ("Serveur", "Communauté", "Communication") dans lesquelles il fallait
// deviner ce qui se cachait. Demande explicite : « je veux genre des rubriques
// comme Logs, Sécurité, Bienvenue, Voc temporaire, Permission, Giveaway ».
//
// Chaque entrée ne contient donc qu'UNE rubrique, sauf Sécurité qui en
// regroupe quatre : ses écrans (vue d'ensemble, anti-spam, anti-nuke, rôle de
// mute) forment un seul sujet, et les séparer au premier niveau noierait le
// reste. C'est la seule qui affiche encore un sous-menu.
//
// Un menu déroulant Discord accepte 25 options au maximum : la liste
// ci-dessous en compte moins, et le test scripts/test-panel-rubriques.js
// échoue si elle venait à dépasser.
const FAMILIES = [
  { key: "accueil", label: "Accueil", description: "Statut du bot et alertes de sécurité", sections: ["home"] },
  {
    key: "securite",
    label: "Sécurité",
    description: "Anti-spam, anti-nuke, mots interdits, rôle de mute",
    sections: ["securityOverview", "protection", "guard", "mute"],
  },
  { key: "logs", label: "Logs", description: "Salon de logs par catégorie", sections: ["logs"] },
  { key: "bienvenue", label: "Bienvenue", description: "Message à l'arrivée d'un membre", sections: ["welcome"] },
  { key: "depart", label: "Départ", description: "Message quand un membre s'en va", sections: ["leave"] },
  { key: "vocaux", label: "Vocaux temporaires", description: "Salon générateur de vocaux à la demande", sections: ["voice"] },
  { key: "salons", label: "Salons", description: "Supprimer plusieurs salons d'un coup", sections: ["channels"] },
  { key: "permissions", label: "Permissions", description: "Ce qu'un rôle débloque comme commandes", sections: ["permissions", "roletiers"] },
  { key: "autorole", label: "Rôles automatiques", description: "Rôles donnés à chaque arrivée", sections: ["autorole"] },
  { key: "verification", label: "Vérification", description: "Bouton « Se vérifier » et rôle accordé", sections: ["verification"] },
  { key: "tickets", label: "Tickets", description: "Système de tickets d'assistance", sections: ["tickets"] },
  { key: "giveaways", label: "Giveaways", description: "Concours en cours, tirage et reroll", sections: ["giveaways"] },
  { key: "sondages", label: "Sondages", description: "Créer un sondage à boutons", sections: ["polls"] },
  { key: "annonces", label: "Annonces", description: "Composer et envoyer un embed", sections: ["embedBuilder"] },
  { key: "musique", label: "Musique", description: "Lecteur en cours et favoris", sections: ["musicPlayer"] },
  { key: "historique", label: "Historique", description: "Rechercher dans l'historique de modération", sections: ["history"] },
  { key: "statistiques", label: "Statistiques", description: "Compteurs et activité des 7 derniers jours", sections: ["stats"] },
  { key: "diagnostics", label: "Diagnostics", description: "Uptime, latence, mémoire, nœuds Lavalink", sections: ["diagnostics"] },
  { key: "sauvegardes", label: "Sauvegardes", description: "Sauvegarder et restaurer la structure", sections: ["backups"] },
  { key: "profil", label: "Profil du bot", description: "Nom, photo, bannière et statut du bot", sections: ["botProfile"] },
  { key: "prefixes", label: "Préfixes", description: "Préfixe musique et préfixe des commandes", sections: ["prefixes"] },
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

function permissionRows() {
  return permCatalog.byCategory().flatMap((group) => [
    `**${group.label}**`,
    ...group.permissions.map((p) => `> \`${p.key}\` — ${p.label}`),
  ]);
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
    return [
      `> **Préfixe musique** : \`${prefixes.main}\``,
      `> **Préfixe des commandes** : \`${prefixes.musicMod}\``,
    ].join("\n");
  }

  if (section === "moderation") {
    return [
      // La dispense « accès legacy aux salons » a été retirée sur demande :
      // il ne reste que celle qui sert vraiment, le quota de `uo clear`.
      `> **Dispensés du quota de \`uo clear\`** : ${mentions(accessStore.list("clear"))}`,
    ].join("\n");
  }

  // "Permissions" et "Rôles" étaient deux rubriques qui commençaient toutes
  // deux par "choisis un rôle" — au point que la seconde avait un bouton pour
  // sauter vers la première. Fusionnées : un seul sélecteur de rôle, puis
  // TOUT ce qui concerne ce rôle, ses informations comme ses permissions.
  if (section === "permissions") {
    const roleId = state.permissionsRoleId;
    if (!roleId) return "> *Choisis un rôle dans le menu ci-dessous.*";
    const role = guild.roles.cache.get(roleId);
    if (!role) return "> *Ce rôle n'existe plus sur le serveur.*";

    // Seules les permissions Discord qui donnent un vrai pouvoir : lister les
    // 40 autres noierait celles qui comptent.
    const notables = role.permissions
      .toArray()
      .filter((perm) =>
        ["Administrator", "BanMembers", "KickMembers", "ModerateMembers", "ManageRoles", "ManageChannels", "ManageGuild", "ManageMessages"].includes(perm)
      );
    const granted = permStore.getRoleGrants(guildId, roleId);
    // Le catalogue complet n'est pas recopié : le menu déroulant plus bas les
    // liste déjà toutes, en cochant celles qui sont accordées.
    const parCategorie = permCatalog
      .byCategory()
      .map((group) => {
        const n = group.permissions.filter((perm) => granted.includes(perm.key)).length;
        return n ? `> **${group.label}** : ${n}` : null;
      })
      .filter(Boolean);

    const lines = [
      `> **Rôle** : ${role.toString()} — \`${role.id}\``,
      `> **Membres** : ${role.members.size} · **position** : ${role.position}/${guild.roles.cache.size} · **couleur** : ${role.hexColor}`,
      `> **Exclusif** : ${permStore.isRoleExclusive(guildId, roleId) ? "oui" : "non"}`,
      `> **Permissions Discord notables** : ${notables.length ? notables.join(", ") : "*aucune*"}`,
      `> **Permissions du bot accordées** : ${granted.length}`,
      ...parCategorie,
    ];

    // Les commandes débloquées sont affichées d'office : un compte par
    // catégorie ne dit pas CE que le rôle peut faire. L'ancien bouton "Voir
    // les commandes débloquées" renvoyait la liste dans un message éphémère,
    // à côté du panneau au lieu d'être dedans.
    //
    // UNE LIGNE PAR COMMANDE, et non plus toutes collées en une seule ligne de
    // virgules : c'est ce qui les fait atterrir dans la carte « Commandes
    // débloquées » du tableau de bord (utils/sectionDashboard.js range chaque
    // ligne citée comme une entrée, et ouvre une carte « (suite) » au-delà de
    // neuf). Collées, elles formaient une phrase unique rejetée en bas d'écran
    // et tronquée par le moteur de rendu.
    const prefixeCommandes = getPrefixes(guildId).musicMod;
    const commands = commandsForKeys(granted);
    lines.push("", `**Commandes débloquées (${commands.length})** :`);
    if (!commands.length) {
      lines.push("> *aucune*");
    } else {
      for (const c of commands.slice(0, MAX_COMMANDES_AFFICHEES)) lines.push(`> \`${prefixeCommandes}${c}\``);
      const reste = commands.length - MAX_COMMANDES_AFFICHEES;
      if (reste > 0) lines.push(`> +${reste} autre${reste > 1 ? "s" : ""}`);
    }
    // Une clé accordée peut donner accès à une rubrique du panel plutôt
    // qu'à une commande tapée — sans cette section, "0 commande" donnait
    // l'impression fausse que rien n'était accordé du tout.
    const autres = nonCommandGrants(granted);
    if (autres.length) {
      lines.push("", `**Accès sans commande dédiée (${autres.length})** :`);
      for (const l of autres.slice(0, MAX_COMMANDES_AFFICHEES)) lines.push(`> ${l}`);
      const resteAutres = autres.length - MAX_COMMANDES_AFFICHEES;
      if (resteAutres > 0) lines.push(`> +${resteAutres} autre${resteAutres > 1 ? "s" : ""}`);
    }

    // Les membres du rôle, eux aussi dans l'image plutôt que dans un message
    // éphémère qu'il fallait ouvrir à côté.
    if (state.permissionsShowMembers) {
      // `role.members` est une Collection sur un vrai rôle, mais l'objet reçu
      // peut être partiel selon l'appelant : on ne suppose pas sa forme.
      const tous = typeof role.members?.values === "function" ? [...role.members.values()] : [];
      const membres = tous.slice(0, 30);
      const reste = (role.members?.size || 0) - membres.length;
      lines.push("", `**Membres ayant ce rôle (${role.members.size})** :`);
      lines.push(
        membres.length
          ? membres.map((m) => m.user?.username || m.id).join(", ") + (reste > 0 ? `, +${reste}` : "")
          : "*personne*"
      );
    }

    return lines.join("\n");
  }

  // Même contenu que &perms + &helpall réunis (utils/permsCommands.js), mais
  // dans le panel : demande explicite pour voir tous les paliers ET tous les
  // rôles d'un coup, sans taper deux commandes séparées.
  if (section === "roletiers") {
    const tiers = computeTiers(guildId);
    const exclusiveRoleIds = permStore.listExclusiveRoles(guildId);
    if (!tiers.length && !exclusiveRoleIds.length) {
      return "> *Aucune permission n'est encore accordée à un rôle (voir la rubrique Rôles et permissions).*";
    }
    const lines = [];
    for (const tier of tiers) {
      const roles = tier.roleIds.length ? tier.roleIds.map((id) => `<@&${id}>`).join(", ") : "*aucun*";
      const commands = commandsForKeys(tier.keys);
      lines.push(`**Permission ${tier.index}**`);
      lines.push(`> **Rôles** : ${roles}`);
      lines.push(`> **Commandes débloquées (${commands.length})** : ${commands.length ? commands.join(", ") : "*aucune*"}`);
      lines.push("");
    }
    if (exclusiveRoleIds.length) {
      lines.push("**Exclusives**");
      lines.push(`> **Rôles** : ${exclusiveRoleIds.map((id) => `<@&${id}>`).join(", ")}`);
    }
    return lines.join("\n").trim();
  }

  if (section === "logs") {
    const channels = getAllLogChannels(guildId);
    const manage = can(member, "logs.manage");
    const lines = Object.entries(channels).map(
      ([cat, chId]) => `> **${LOG_CATEGORY_LABELS[cat]}** : ${chId ? `<#${chId}>` : "*aucun — désactivé*"}`
    );
    const catLabel = state.logsCategory ? LOG_CATEGORY_LABELS[state.logsCategory] : null;
    return [
      ...lines,
      // Seules exceptions à la règle "pas de prose" : dire qu'on est en lecture
      // seule, et nommer la catégorie en cours d'édition. Sans elles, les
      // contrôles affichés en dessous n'ont pas de sens.
      manage ? null : "> *Lecture seule — le droit `logs.manage` est requis pour modifier.*",
      manage && catLabel ? `> *Catégorie en cours : **${catLabel}** — choisis son salon ci-dessous.*` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
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
    const lavalink = info.lavalinkNodes.length
      ? info.lavalinkNodes.map((n) => `> \`${n.name}\` : ${n.connected ? "🟢 connecté" : `🔴 état ${n.state}`}`).join("\n")
      : "> *aucun nœud déclaré*";
    return [
      `> **Uptime** : ${formatUptime(info.uptimeMs)} · **latence** : ${info.ping}ms · **mémoire** : ${info.memoryRssMB} Mo`,
      `> **Serveurs** : ${info.guildCount} · **Node.js** : ${info.nodeVersion} · **discord.js** : v${info.discordjsVersion}`,
      "",
      "**Lavalink :**",
      lavalink,
    ].join("\n");
  }

  if (section === "history") {
    const recent = historyStore.search(guildId, { limit: 5 });
    const lines = recent.map((e) => {
      const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
      return `> \`${e.action}\` ${e.targetTag ? `**${e.targetTag}**` : ""} — par ${e.moderatorTag || e.moderatorId} — ${when}`;
    });
    return [
      "**5 dernières actions :**",
      lines.length ? lines.join("\n") : "*Aucune entrée pour l'instant.*",
    ].join("\n");
  }

  if (section === "securityOverview") {
    const { critical, warnings, ok } = computeSecurityScan(guild);
    const emoji = critical.length ? "🔴" : warnings.length ? "🟠" : "🟢";
    const lines = [`${emoji} **${ok.length}** OK · **${warnings.length}** avertissement(s) · **${critical.length}** critique(s)`];
    if (critical.length) lines.push("", "**🔴 Critique :**", ...critical.map((l) => `> ${l}`));
    if (warnings.length) lines.push("", "**🟠 Avertissements :**", ...warnings.map((l) => `> ${l}`));
    if (!critical.length && !warnings.length) lines.push("", "*Tout est en ordre — voir le détail dans Protection/Anti-nuke/Mute.*");
    return lines.join("\n");
  }

  if (section === "protection") {
    const config = automod.getConfig(guildId);
    const whitelist = automod.getWhitelist(guildId);
    const linkConfig = antiLink.getConfig(guildId);
    const linkAllowed = antiLink.getAllowedChannels(guildId);
    const mentionConfig = antiMention.getConfig(guildId);
    const wordsConfig = badWords.getConfig(guildId);
    const words = badWords.getWords(guildId);
    return [
      `> **Anti-spam/anti-flood** : ${config.enabled ? "activé" : "désactivé"}`,
      `> Seuil : ${config.maxMessages} messages en ${config.windowSeconds}s déclenchent un timeout de ${config.timeoutSeconds}s`,
      // Les salons exemptés d'anti-spam n'étaient nulle part : on pouvait en
      // configurer par commande sans jamais les revoir dans le panel.
      `> Salons exemptés : ${automod.getExemptChannels(guildId).length ? automod.getExemptChannels(guildId).map((id) => `<#${id}>`).join(", ") : "*aucun*"}`,
      "",
      `> **Anti-lien** : ${linkConfig.enabled ? "activé" : "désactivé"} (mode : ${linkConfig.mode === "all" ? "tous les liens" : "invitations Discord"})`,
      `> Salons où les liens restent autorisés : ${linkAllowed.length ? linkAllowed.map((id) => `<#${id}>`).join(", ") : "*aucun*"}`,
      "",
      `> **Anti-mass-mention** : ${mentionConfig.enabled ? "activé" : "désactivé"} (seuil : ${mentionConfig.maxMentions} mentions, timeout ${mentionConfig.timeoutSeconds}s)`,
      "",
      `> **Mots interdits** : ${wordsConfig.enabled ? "activé" : "désactivé"} (${words.length} mot(s) dans la liste)`,
      "",
      `> **Whitelist (exemptés)** : ${mentions([...whitelist.users, ...whitelist.roles])}`,
    ].join("\n");
  }

  if (section === "guard") {
    const config = guardConfig.getConfig(guildId);
    const whitelist = guardWhitelist.getWhitelist(guildId);
    // Juste la clé (pas le libellé complet) + le seuil : la description de
    // chaque guard vit dans &help, pas ici — même règle "montre, n'explique
    // pas" que le reste du panel.
    const guardLines = ALL_GUARDS.map((d) => {
      const rule = d.threshold ? `${d.threshold.count}/${d.threshold.windowMs / 1000}s` : "immédiat";
      const on = guardConfig.isGuardEnabled(guildId, d.key);
      return `> ${on ? "🟢" : "🔴"} \`${d.key}\` (${rule})`;
    });
    return [
      `> **Anti-nuke** (interrupteur général) : ${config.enabled ? "activé" : "désactivé"}`,
      `> **Sanction** : ${config.punishment}${config.punishment === "timeout" ? ` (${config.punishmentDurationMs / 60000} min)` : ""}`,
      `> **Ping** : ${config.pingRoleId ? `<@&${config.pingRoleId}>` : "*aucun*"}`,
      `> **Compte minimum** : ${config.creationLimitMs ? `${Math.round(config.creationLimitMs / 86400000)}j` : "*désactivé*"}`,
      `> **Verrouillage auto si plafond atteint** : ${config.autoLockdownOnCap ? "activé" : "désactivé"}`,
      `> **Whitelist** : ${mentions([...whitelist.users, ...whitelist.roles])}`,
      "",
      ...guardLines,
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
    for (const [userId, keys] of permStore.listUserGrants(guildId)) rows.push([userId, `octroi individuel (${keys.length})`]);

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

  if (section === "mute") {
    const roleId = muteStore.getMuteRoleId(guildId);
    return [
      `> **Rôle de mute** : ${roleId && guild.roles.cache.has(roleId) ? `<@&${roleId}>` : "*aucun — non configuré*"}`,
    ].join("\n");
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

  if (section === "voice") {
    const hubId = voiceChannels.getHub(guildId);
    const hubConfig = voiceChannels.getHubConfig(guildId);
    const spawnOk = hubConfig.spawnCategoryId && guild.channels.cache.has(hubConfig.spawnCategoryId);
    const panelOk = hubConfig.panelChannelId && guild.channels.cache.has(hubConfig.panelChannelId);
    return [
      `> **Salon générateur** : ${hubId && guild.channels.cache.has(hubId) ? `<#${hubId}>` : "*aucun — désactivé*"}`,
      `> **Catégorie des salons créés** : ${spawnOk ? `<#${hubConfig.spawnCategoryId}>` : "*par défaut, même catégorie que le générateur*"}`,
      `> **Salon-panneau partagé** : ${panelOk ? `<#${hubConfig.panelChannelId}>` : "*aucun — le bouton \"Gérer mon salon\" n'apparaît pas*"}`,
      `> **Modèle de nom** : \`${hubConfig.voiceNameTemplate}\``,
      "",
      "Un seul panneau à boutons, partagé par tout le monde : il agit sur le salon vocal où la personne qui clique est connectée. " +
        "Fini le salon texte compagnon créé puis détruit à chaque salon vocal.",
      "",
      hubId && guild.channels.cache.has(hubId)
        ? "Configuré manuellement ou via \"Créer la configuration\" — le bouton ci-dessous ne recrée rien tant que c'est actif."
        : "\"Créer la configuration\" crée en un clic les deux catégories, le salon générateur et le salon-panneau.",
    ].join("\n");
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

  if (section === "musicPlayer") {
    const player = guild.client.kazagumo?.players?.get(guildId);
    if (!player || !player.queue.current) return "> *Aucune lecture en cours.*";
    const track = player.queue.current;
    return [
      `> **En cours** : [${track.title}](${track.uri})`,
      `> **Demandé par** : <@${track.requester?.id || "?"}>`,
      `> **État** : ${player.paused ? "en pause" : "lecture"} · **volume** : ${player.volume}% · **boucle** : ${LOOP_LABELS[player.loop] || "désactivée"}`,
      `> **File d'attente** : ${player.queue.length} titre(s)`,
    ].join("\n");
  }

  if (section === "banall") {
    return [
      `> **Autorisés** : ${mentions(accessStore.list("banall"))}`,
      // Exception assumée à la règle "pas de prose" : c'est le seul écran du
      // panel dont un mauvais clic bannit le serveur entier.
      "> ⚠️ *`banall` bannit tout le serveur d'un coup. Le propriétaire y a toujours droit sans figurer ici.*",
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
    if (can(member, "protection.automod") || can(member, "protection.guard.manage")) {
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
    `> **Préfixe musique** : \`${prefixes.main}\``,
    `> **Préfixe des commandes** : \`${prefixes.musicMod}\``,
    `> **Propriétaire(s)** : ${mentions(owners)}`,
    `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
    `> **Rôles avec des permissions accordées** : ${permStore.listRoleGrants(guildId).length}`,
  ].join("\n");
}

/**
 * Adapte une interaction en objet "message" minimal pour réutiliser
 * TEL QUEL utils/serverAdminCommands.js::roleAdmin (create/delete déjà
 * testés, avec confirmation et journalisation) plutôt que réimplémenter la
 * création/suppression de rôle depuis le panel.
 */
function messageFromInteraction(interaction) {
  return {
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    author: interaction.user,
    mentions: { roles: { first: () => null } },
    // update(), pas reply() : on vient toujours d'un clic sur LE panneau
    // (bouton, modale ouverte depuis un bouton), donc le résultat doit
    // remplacer son contenu, pas ouvrir un second message replié
    // ("Clique pour voir le message") à côté. Même principe que la carte de
    // formulaire lancée depuis le panel (voir utils/fakeMessage.js::
    // remplacerParLaReponse), appliqué ici aux commandes admin de rôle/salon
    // (create/rename/delete...) et à leur confirmation
    // (utils/serverAdminCommands.js::requestConfirmation).
    reply: (payload) => interaction.update(payload),
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
 * contenu affiché sans avoir à lire une image — même approche que
 * utils/helpPanel.js::buildHelpSpec, et garantie plus solide qu'une
 * expression régulière sur du markdown.
 * @param {string} [corps] sortie de sectionBody(), recalculée si absente
 */
function buildSectionSpec(guild, section, member, state = {}, corps) {
  const meta = SECTIONS.find((s) => s.key === section) || SECTIONS[0];
  return sectionDashboard.enSpec(corps ?? sectionBody(meta.key, guild, member, state), {
    titre: meta.label,
    couleur: FAMILY_COLORS[familyOf(meta.key).key] || TEINTE_NEUTRE,
    sousTitre: `${member.displayName || member.user?.username || meta.label} · Préfixe : ${getPrefixes(guild.id).musicMod}`,
    guild,
    // Nombre de colonnes laissé à enSpec : il le déduit de la longueur réelle
    // des lignes (deux colonnes seulement si rien n'y serait tronqué).
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

  const enteteLignes = ["## 「 PANEL DE CONFIGURATION 」", `> <@${member.id}> · Préfixe : \`${getPrefixes(guild.id).musicMod}\``];
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
  const specRubrique = buildSectionSpec(guild, meta.key, member, state, corps);
  const pngRubrique = sansImage ? null : rendreEnCache(specRubrique);
  if (pngRubrique) {
    fichiers.push(new AttachmentBuilder(pngRubrique, { name: NOM_IMAGE_RUBRIQUE, description: texteAlternatif(specRubrique) }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${NOM_IMAGE_RUBRIQUE}`))
    );
  } else {
    // Le corps d'origine, pas enTexte(spec) : ici le texte Discord est
    // MEILLEUR que sa transposition (il résout les mentions et les dates
    // tout seul). Le repli rend donc la rubrique telle qu'elle était.
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(corps));
  }
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buildNav(meta.key, member, isOwner)));
  const subNav = buildSubNav(meta.key, member, isOwner);
  if (subNav) container.addActionRowComponents(new ActionRowBuilder().addComponents(subNav));

  if (meta.key === "prefixes") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:prefix:main`).setLabel("Préfixe musique").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID}:prefix:musicMod`).setLabel("Préfixe commandes").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "moderation") {
    for (const row of accessRows("clear", "dispense de nettoyage")) container.addActionRowComponents(row);
  } else if (meta.key === "permissions") {
    const peutModifier = can(member, "panel.permissions.manage");
    // Trois étapes (rôle → catégorie → clés) plutôt qu'un unique menu avec
    // toutes les clés : Discord plafonne un menu à 25 options, et le
    // catalogue (utils/permissions/catalog.js) a vocation à grandir —
    // chaque catégorie reste largement sous la limite, indéfiniment.
    // Le sélecteur de rôle DISPARAÎT une fois un rôle choisi : il ne sert
    // plus à rien à ce moment-là et poussait les vrais réglages hors de
    // l'écran. Pour en changer, l'action "Choisir un autre rôle" plus bas.
    const roleChoisi = state.permissionsRoleId && guild.roles.cache.has(state.permissionsRoleId);
    if (!roleChoisi) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder().setCustomId(`${ID}:permrole`).setPlaceholder("Choisir un rôle à configurer")
        )
      );
    }
    if (peutModifier) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:rolecreate`).setLabel("Créer un rôle").setStyle(ButtonStyle.Success)
        )
      );
    }
    if (state.permissionsRoleId && guild.roles.cache.has(state.permissionsRoleId)) {
      // Bascules encodées dans le customId lui-même (pas d'état côté
      // serveur entre deux interactions) : le libellé/l'action reflètent ce
      // que CE rendu affiche déjà, donc un clic fait toujours l'inverse.
      const exclusif = permStore.isRoleExclusive(guild.id, state.permissionsRoleId);
      // Les commandes débloquées sont maintenant TOUJOURS dans l'image : plus
      // de bascule "Voir / Masquer". Ne reste que de quoi changer de rôle.
      const boutons = [
        new ButtonBuilder()
          .setCustomId(`${ID}:permrolereset`)
          .setLabel("Choisir un autre rôle")
          .setStyle(ButtonStyle.Secondary)
          ,
      ];
      if (can(member, "server.members.list")) {
        boutons.push(
          state.permissionsShowMembers
            ? new ButtonBuilder()
                .setCustomId(`${ID}:rolemembershide:${state.permissionsRoleId}`)
                .setLabel("Masquer les membres")
                .setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder()
                .setCustomId(`${ID}:rolemembers:${state.permissionsRoleId}`)
                .setLabel("Voir les membres")
                .setStyle(ButtonStyle.Secondary)
        );
      }
      if (peutModifier) {
        boutons.push(
          new ButtonBuilder()
            .setCustomId(`${ID}:renamerole:${state.permissionsRoleId}`)
            .setLabel("Renommer")
            .setStyle(ButtonStyle.Secondary)
        );
        boutons.push(
          exclusif
            ? new ButtonBuilder()
                .setCustomId(`${ID}:roleexclusiveoff:${state.permissionsRoleId}`)
                .setLabel("Retirer de l'exclusif")
                .setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder()
                .setCustomId(`${ID}:roleexclusive:${state.permissionsRoleId}`)
                .setLabel("Ajouter à l'exclusif")
                .setStyle(ButtonStyle.Secondary)
        );
        boutons.push(
          new ButtonBuilder()
            .setCustomId(`${ID}:roledelete:${state.permissionsRoleId}`)
            .setLabel("Supprimer ce rôle")
            .setStyle(ButtonStyle.Danger)
        );
      }
      container.addActionRowComponents(new ActionRowBuilder().addComponents(...boutons));
    }
    if (peutModifier && state.permissionsRoleId && guild.roles.cache.has(state.permissionsRoleId)) {
      const categories = permCatalog.byCategory();
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:permcat:${state.permissionsRoleId}`)
            .setPlaceholder("Choisir une catégorie de permissions")
            .addOptions(
              categories.map((c) =>
                new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.category).setDefault(state.permissionsCategory === c.category)
              )
            )
        )
      );
      const activeCategory = categories.find((c) => c.category === state.permissionsCategory);
      if (activeCategory) {
        const granted = permStore.getRoleGrants(guild.id, state.permissionsRoleId);
        const options = activeCategory.permissions
          .filter((p) => p.roleGrantable !== false)
          .map((p) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(p.label.slice(0, 100))
              .setDescription(p.key)
              .setValue(p.key)
              .setDefault(granted.includes(p.key))
          );
        if (options.length) {
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`${ID}:permkeys:${state.permissionsRoleId}:${activeCategory.category}`)
                .setPlaceholder(`Permissions "${activeCategory.label}" accordées à ce rôle`)
                .setMinValues(0)
                .setMaxValues(options.length)
                .addOptions(options)
            )
          );
        }
      }
    }
  } else if (meta.key === "roletiers") {
    // Vue d'ensemble façon &perms/&helpall (mêmes paliers, calculés par
    // utils/permsCommands.js::computeTiers — rien de nouveau à stocker),
    // mais DANS le panel et avec un raccourci direct vers le renommage,
    // plutôt que deux commandes texte à lire côte à côte puis retourner
    // choisir le rôle à la main dans "Rôles et permissions".
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${ID}:tierrenamepick`).setPlaceholder("Choisir un rôle à renommer")
      )
    );
    // Provisionnement en masse (utils/rolePresets.js) : la hiérarchie de
    // rôles vue sur les deux screens fournis, avec les permissions déjà
    // réglées — demande explicite, rang sys (ça touche TOUS les rôles du
    // serveur, effet largement plus grand qu'une action de modération).
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
  } else if (meta.key === "logs") {
    if (can(member, "logs.manage")) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:logcat`)
            .setPlaceholder("Configurer un salon manuellement — choisir une catégorie")
            .addOptions(
              Object.entries(LOG_CATEGORY_LABELS).map(([key, label]) =>
                new StringSelectMenuOptionBuilder().setLabel(label).setValue(key).setDefault(state.logsCategory === key)
              )
            )
        )
      );
      if (state.logsCategory && LOG_CATEGORY_LABELS[state.logsCategory]) {
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
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:logauto`)
            .setLabel("Créer les salons automatiquement")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${ID}:logdelete`)
            .setLabel("Supprimer les salons de logs")
            .setStyle(ButtonStyle.Danger)
        )
      );
    }
  } else if (meta.key === "history") {
    if (!state.historySearchOpen) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:history:search`).setLabel("Rechercher").setStyle(ButtonStyle.Secondary)
        )
      );
    } else {
      const targetId = state.historySearchTarget || null;
      const moderatorId = state.historySearchModerator || null;
      const targetSelect = new UserSelectMenuBuilder()
        .setCustomId(`${ID}:historytarget:${moderatorId || "_"}`)
        .setPlaceholder("Filtrer par cible")
        .setMinValues(0)
        .setMaxValues(1);
      if (targetId) targetSelect.setDefaultUsers([targetId]);
      const moderatorSelect = new UserSelectMenuBuilder()
        .setCustomId(`${ID}:historymoderator:${targetId || "_"}`)
        .setPlaceholder("Filtrer par modérateur")
        .setMinValues(0)
        .setMaxValues(1);
      if (moderatorId) moderatorSelect.setDefaultUsers([moderatorId]);
      container.addActionRowComponents(new ActionRowBuilder().addComponents(targetSelect));
      container.addActionRowComponents(new ActionRowBuilder().addComponents(moderatorSelect));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:historytextopen:${targetId || "_"}:${moderatorId || "_"}`)
            .setLabel("Filtrer par type/ID...")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`${ID}:historyrun:${targetId || "_"}:${moderatorId || "_"}`)
            .setLabel("Rechercher")
            .setStyle(ButtonStyle.Success)
        )
      );
    }
  } else if (meta.key === "protection") {
    const words = badWords.getWords(guild.id);

    const options = [
      { value: "spam_toggle", label: "Anti-spam : activer/désactiver" },
      { value: "spam_threshold", label: "Anti-spam : changer le seuil (messages / secondes)" },
      { value: "spam_timeout", label: "Anti-spam : durée du timeout" },
      { value: "spam_exempt", label: "Anti-spam : salons exemptés" },
      { value: "link_toggle", label: "Anti-lien : activer/désactiver" },
      { value: "link_mode", label: "Anti-lien : changer le mode (invitations ↔ tous les liens)" },
      { value: "link_allow", label: "Anti-lien : salons où les liens restent autorisés" },
      { value: "mention_toggle", label: "Anti-mass-mention : activer/désactiver" },
      { value: "mention_threshold", label: "Anti-mass-mention : changer le seuil" },
      { value: "mention_timeout", label: "Anti-mass-mention : durée du timeout" },
      { value: "badwords_toggle", label: "Mots interdits : activer/désactiver" },
      { value: "badwords_add", label: "Mots interdits : ajouter un mot" },
      ...(words.length ? [{ value: "badwords_remove", label: "Mots interdits : retirer un mot" }] : []),
      ...(can(member, "protection.whitelist")
        ? [
            { value: "whitelist_add", label: "Whitelist : ajouter quelqu'un" },
            { value: "whitelist_remove", label: "Whitelist : retirer quelqu'un" },
          ]
        : []),
    ];

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:protectionaction`)
          .setPlaceholder("Choisir une action")
          .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setLabel(o.label.slice(0, 100)).setValue(o.value)))
      )
    );

    if (state.protectionAction === "badwords_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:badwords:add`).setLabel("Ouvrir la fenêtre d'ajout").setStyle(ButtonStyle.Secondary)
        )
      );
    } else if (state.protectionAction === "badwords_remove" && words.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:badwords:del`)
            .setPlaceholder("Retirer un mot interdit")
            .addOptions(words.slice(0, 25).map((w) => new StringSelectMenuOptionBuilder().setLabel(w.slice(0, 100)).setValue(w)))
        )
      );
    } else if (state.protectionAction === "spam_exempt") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${ID}:spamexempt`)
            .setPlaceholder("Salons où l'anti-spam ne s'applique pas")
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultChannels(automod.getExemptChannels(guild.id).filter((id) => guild.channels.cache.has(id)).slice(0, 25))
        )
      );
    } else if (state.protectionAction === "link_allow") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`${ID}:linkallow`)
            .setPlaceholder("Salons où les liens restent autorisés")
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(0)
            .setMaxValues(25)
            .setDefaultChannels(antiLink.getAllowedChannels(guild.id).filter((id) => guild.channels.cache.has(id)).slice(0, 25))
        )
      );
    } else if (state.protectionAction === "whitelist_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:wladd`).setPlaceholder("Ajouter à la whitelist anti-spam"))
      );
    } else if (state.protectionAction === "whitelist_remove") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:wldel`).setPlaceholder("Retirer de la whitelist anti-spam"))
      );
    }
    // Les autres actions (spam_toggle/link_toggle/link_mode/mention_toggle/
    // mention_threshold/badwords_toggle) s'exécutent immédiatement à la
    // sélection (voir le handler "protectionaction") — rien de plus à afficher.
  } else if (meta.key === "guard") {
    const config = guardConfig.getConfig(guild.id);

    const options = [
      { value: "guard_toggle", label: config.enabled ? "Anti-nuke : désactiver" : "Anti-nuke : activer" },
      { value: "guard_punishment", label: "Changer la sanction (timeout → kick → ban)" },
      { value: "guard_pick", label: "Activer/désactiver un guard précis" },
      { value: "guard_wl_add", label: "Whitelist : ajouter quelqu'un" },
      { value: "guard_wl_remove", label: "Whitelist : retirer quelqu'un" },
      { value: "guard_wl_role_add", label: "Whitelist : ajouter un rôle" },
      { value: "guard_wl_role_remove", label: "Whitelist : retirer un rôle" },
      { value: "guard_ping", label: "Changer le rôle pingé" },
      { value: "guard_creationlimit", label: "Changer le seuil de compte" },
      { value: "guard_autolockdown_toggle", label: config.autoLockdownOnCap ? "Verrouillage auto : désactiver" : "Verrouillage auto : activer" },
    ];

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:guardaction`)
          .setPlaceholder("Choisir une action")
          .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setLabel(o.label.slice(0, 100)).setValue(o.value)))
      )
    );

    if (state.guardAction === "guard_pick") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:guardpick`)
            .setPlaceholder("Choisir un guard")
            .addOptions(
              ALL_GUARDS.map((d) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(d.label.slice(0, 100))
                  .setDescription(d.key)
                  .setValue(d.key)
                  .setDefault(state.guardKey === d.key)
              )
            )
        )
      );
      if (state.guardKey) {
        const def = ALL_GUARDS.find((d) => d.key === state.guardKey);
        if (def) {
          const on = guardConfig.isGuardEnabled(guild.id, def.key);
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`${ID}:guardtoggle:${def.key}`)
                .setLabel(`${def.label} : ${on ? "désactiver" : "activer"}`)
                .setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success)
            )
          );
        }
      }
    } else if (state.guardAction === "guard_wl_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:guardwladd`).setPlaceholder("Ajouter à la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_wl_remove") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:guardwldel`).setPlaceholder("Retirer de la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_wl_role_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`${ID}:guardwlroleadd`).setPlaceholder("Ajouter un rôle à la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_wl_role_remove") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`${ID}:guardwlroledel`).setPlaceholder("Retirer un rôle de la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_ping") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(`${ID}:guardping`)
            .setPlaceholder("Rôle à pinguer (vide = aucun)")
            .setMinValues(0)
            .setDefaultRoles(config.pingRoleId && guild.roles.cache.has(config.pingRoleId) ? [config.pingRoleId] : [])
        )
      );
    } else if (state.guardAction === "guard_creationlimit") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:guardcreationlimit`).setLabel("Régler le seuil de création de compte").setStyle(ButtonStyle.Secondary)
        )
      );
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
  } else if (meta.key === "mute") {
    const roleId = muteStore.getMuteRoleId(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:muterole`)
          .setPlaceholder("Choisir le rôle de mute (vide = aucun)")
          .setMinValues(0)
          .setDefaultRoles(roleId && guild.roles.cache.has(roleId) ? [roleId] : [])
      )
    );
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
  } else if (meta.key === "voice") {
    const hubId = voiceChannels.getHub(guild.id);
    const hubConfig = voiceChannels.getHubConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:voicehubchannel`)
          .setPlaceholder("Choisir le salon générateur")
          .addChannelTypes(ChannelType.GuildVoice)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(hubId && guild.channels.cache.has(hubId) ? [hubId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:voicespawncategory`)
          .setPlaceholder("Choisir la catégorie des salons créés (optionnel)")
          .addChannelTypes(ChannelType.GuildCategory)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(hubConfig.spawnCategoryId && guild.channels.cache.has(hubConfig.spawnCategoryId) ? [hubConfig.spawnCategoryId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:voicepanelchannel`)
          .setPlaceholder("Choisir le salon-panneau partagé (optionnel)")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(hubConfig.panelChannelId && guild.channels.cache.has(hubConfig.panelChannelId) ? [hubConfig.panelChannelId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ID}:voicehubsetup`)
          .setLabel("Créer la configuration")
          .setStyle(ButtonStyle.Success)
          .setDisabled(Boolean(hubId && guild.channels.cache.has(hubId))),
        new ButtonBuilder().setCustomId(`${ID}:voicenames`).setLabel("Modifier les noms").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${ID}:voicepanelrefresh`)
          .setLabel("Actualiser le panneau")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!(hubConfig.panelChannelId && guild.channels.cache.has(hubConfig.panelChannelId)))
      )
    );
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
  } else if (meta.key === "musicPlayer") {
    const player = guild.client.kazagumo?.players?.get(guild.id);
    const npMessage = guild.client.nowPlayingMessages?.get(guild.id);
    const boutons = [];
    // Lien direct vers le VRAI panneau de lecture (déjà suivi/rafraîchi par
    // utils/musicPlayer.js) plutôt qu'une copie de ses boutons ici : les
    // customId music_* sont routés par index.js en supposant qu'ils vivent
    // sur CE message précis (il l'édite en retour) — les dupliquer dans le
    // panel désynchroniserait les deux affichages.
    if (player?.queue?.current && npMessage) {
      boutons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Ouvrir le lecteur").setURL(npMessage.url));
    }
    boutons.push(new ButtonBuilder().setCustomId(`${ID}:musicfavlist`).setLabel("Mes favoris").setStyle(ButtonStyle.Secondary));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...boutons));
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
  regrouperBoutonsEnMenu(container);

  return { flags: MessageFlags.IsComponentsV2, components: [container], ...(fichiers.length ? { files: fichiers } : {}) };
}

const PREFIX_FIELDS = {
  main: { label: "Préfixe musique", max: 5 },
  musicMod: { label: "Préfixe des commandes", max: 5 },
};

/**
 * Résultats de recherche d'historique, formatés pour une réponse éphémère
 * (pas de mutation du panneau partagé : c'est une consultation personnelle).
 */
function formatHistoryResults(results) {
  if (!results.length) return "Aucune entrée ne correspond à cette recherche.";
  return results
    .map((e) => {
      const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:f>`;
      return [
        `\`${e.action}\` — ${when}`,
        e.targetTag ? `Cible : **${e.targetTag}** (${e.targetId})` : null,
        `Modérateur : ${e.moderatorTag || e.moderatorId}`,
        e.reason ? `Raison : ${e.reason}` : null,
        `ID : \`${e.id}\``,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

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

  if (action === "permrole") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: interaction.values[0] });
  }

  // Choisi depuis la vue d'ensemble des paliers (rubrique "Rôles (paliers)") :
  // saute direct dans "Rôles et permissions", où vivent déjà la fiche
  // complète du rôle ET le bouton "Renommer" — pas une deuxième modale à
  // maintenir en parallèle pour la même action.
  if (action === "tierrenamepick") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: interaction.values[0] });
  }

  // Provisionnement en masse (utils/rolePresets.js) — voir le sélecteur dans
  // la rubrique "Rôles (paliers)". Passe par messageFromInteraction comme le
  // reste des commandes admin du panel : la confirmation ET son exécution
  // remplacent le panel en place, jamais un second message à côté.
  if (action === "rolepresets") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const choix = interaction.values[0];
    if (choix === "create") return rolePresets.createPresetRoles(interaction.client, messageFromInteraction(interaction));
    if (choix === "deleteall") return rolePresets.deleteAllRoles(interaction.client, messageFromInteraction(interaction));
    return;
  }

  // Revenir au sélecteur de rôle : il disparaît une fois un rôle choisi, donc
  // il faut un moyen d'en changer sans quitter la rubrique.
  if (action === "permrolereset") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", {});
  }

  // Les membres du rôle s'affichent DANS l'image du panneau, plus dans un
  // message éphémère ouvert à côté.
  if (action === "rolemembers" || action === "rolemembershide") {
    if (!can(member, "server.members.list")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: extra, permissionsShowMembers: action === "rolemembers" });
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

  // Musique : mêmes deux lignes que le bouton "Mes favoris" du panneau de
  // lecture (index.js) — pas une deuxième implémentation.
  if (action === "musicfavlist") {
    const { main } = getPrefixes(guildId);
    const panel = buildFavoritesPanel(interaction.user.id, main);
    if (!panel) return interaction.reply({ content: "Tu n'as encore aucun favori.", flags: MessageFlags.Ephemeral });
    return interaction.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral });
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
      await backup(interaction.client, messageFromInteraction(interaction), [name]);
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
    await backup(interaction.client, messageFromInteraction(interaction), ["delete", extra]);
    return;
  }

  if (action === "backuprestore") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await backup(interaction.client, messageFromInteraction(interaction), ["load", extra], { doubleConfirm: true });
    return;
  }

  // Profil du bot : réutilise TEL QUEL utils/botProfileCommands.js — même
  // remarque que ci-dessus, aucune deuxième implémentation.
  if (action === "botstatus") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const fn = botProfileHandlers[interaction.values[0]];
    if (!fn) return;
    await fn(interaction.client, messageFromInteraction(interaction));
    return;
  }

  if (action === "botnamebtn") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rien n'a changé.", flags: MessageFlags.Ephemeral });
      await botProfileHandlers.set(interaction.client, messageFromInteraction(interaction), ["name", name]);
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

  // Création/suppression de rôle depuis le panel : réutilise TEL QUEL
  // utils/serverAdminCommands.js::roleAdmin (même vérif de droits, même
  // journal, même confirmation avant suppression) via un objet "message"
  // minimal — pas de logique dupliquée entre &role create/delete et ces
  // boutons.
  if (action === "rolecreate") {
    if (!can(member, "server.roles.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, aucun rôle créé.", flags: MessageFlags.Ephemeral });
      await roleAdmin(interaction.client, messageFromInteraction(interaction), ["create", name]);
      return;
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:rolecreate`).setTitle("Créer un rôle");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nom du rôle").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "renamerole") {
    if (!can(member, "server.roles.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rôle inchangé.", flags: MessageFlags.Ephemeral });
      // roleAdmin résout la cible via un ID brut dans les args (mentions.roles
      // reste toujours vide sur messageFromInteraction) — voir "roledelete"
      // juste en dessous, même mécanique.
      await roleAdmin(interaction.client, messageFromInteraction(interaction), ["rename", extra, ...name.split(/\s+/)]);
      return;
    }
    const role = guild.roles.cache.get(extra);
    if (!role) return interaction.reply({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`${ID}:renamerole:${extra}`).setTitle("Renommer le rôle");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true).setValue(role.name)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "roledelete") {
    if (!can(member, "server.roles.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await roleAdmin(interaction.client, messageFromInteraction(interaction), ["delete", extra]);
    return;
  }

  // "Exclusif" : simple étiquette côté panel, aucun effet sur le calcul des
  // permissions (voir utils/permissions/store.js).
  if (action === "roleexclusive" || action === "roleexclusiveoff") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    permStore.setRoleExclusive(guildId, extra, action === "roleexclusive");
    return goto("permissions", { permissionsRoleId: extra });
  }

  if (action === "permcat") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: extra, permissionsCategory: interaction.values[0] });
  }

  if (action === "permkeys") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    // extra = roleId, extra2 = catégorie affichée dans ce menu : on ne
    // remplace que les clés DE CETTE catégorie, les autres catégories
    // déjà accordées à ce rôle restent intactes.
    const categoryKeys = new Set(
      permCatalog
        .byCategory()
        .find((c) => c.category === extra2)
        ?.permissions.map((p) => p.key) || []
    );
    const current = permStore.getRoleGrants(guildId, extra).filter((k) => !categoryKeys.has(k));
    permStore.setRoleGrants(guildId, extra, [...current, ...interaction.values]);
    return goto("permissions", { permissionsRoleId: extra, permissionsCategory: extra2 });
  }

  // "roleinfo" et "jumpperm" appartenaient à la rubrique "Rôles", fusionnée
  // dans "Rôles et permissions" : une carte restée ouverte peut encore les
  // envoyer, on la redirige plutôt que de la laisser sans effet.
  if (action === "roleinfo") {
    return goto("permissions", { permissionsRoleId: interaction.values[0] });
  }

  if (action === "jumpperm") {
    return goto("permissions", { permissionsRoleId: extra });
  }

  if (action === "logcat") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("logs", { logsCategory: interaction.values[0] });
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
  // identifiant. L'historique reste consultable sous Monitoring — c'est de la
  // consultation, pas une action sur un membre.

  // Recherche d'historique : cible/modérateur se choisissent désormais via
  // UserSelectMenu natif (chips + avatars) au lieu d'un ID/mention tapé à la
  // main — un Modal Discord ne pouvant pas contenir de select menu, le
  // bouton "Rechercher" ouvre maintenant une carte dans le panel lui-même
  // plutôt qu'un Modal direct. Le type d'événement/l'ID précis restent du
  // texte libre (aucun équivalent natif) via un Modal réduit, ouvert depuis
  // cette carte et qui porte cible/modérateur dans son propre customId pour
  // ne pas les perdre.
  if (action === "history" && extra === "search") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("history", { historySearchOpen: true });
  }

  if (action === "historytarget" || action === "historymoderator") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const other = extra !== "_" ? extra : null;
    const chosen = interaction.values[0] || null;
    return goto("history", {
      historySearchOpen: true,
      historySearchTarget: action === "historytarget" ? chosen : other,
      historySearchModerator: action === "historymoderator" ? chosen : other,
    });
  }

  if (action === "historytextopen") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`${ID}:historytextsubmit:${extra}:${extra2}`).setTitle("Filtrer par type/ID");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("action")
          .setLabel("Type (ban, kick, timeout, clear...)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("id").setLabel("ID d'entrée précis").setStyle(TextInputStyle.Short).setRequired(false)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "historytextsubmit") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return handleHistorySearchModal(interaction, {
      targetId: extra !== "_" ? extra : null,
      moderatorId: extra2 !== "_" ? extra2 : null,
    });
  }

  if (action === "historyrun") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const targetId = extra !== "_" ? extra : null;
    const moderatorId = extra2 !== "_" ? extra2 : null;
    const results = historyStore.search(guildId, { targetId: targetId || undefined, moderatorId: moderatorId || undefined, limit: 10 });
    await interaction.update(
      buildConfigPanel(guild, "history", member, { historySearchOpen: true, historySearchTarget: targetId, historySearchModerator: moderatorId })
    );
    const resultContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Résultats de recherche\n${formatHistoryResults(results).slice(0, 3800)}`)
    );
    return interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [resultContainer] });
  }

  if (action === "protectionaction") {
    const choice = interaction.values[0];
    const requiredPerm = choice.startsWith("whitelist_") ? "protection.whitelist" : "protection.automod";
    if (!can(member, requiredPerm)) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });

    if (choice === "spam_toggle") {
      automod.setEnabled(guildId, !automod.getConfig(guildId).enabled);
      return goto("protection");
    }
    if (choice === "link_toggle") {
      antiLink.setEnabled(guildId, !antiLink.getConfig(guildId).enabled);
      return goto("protection");
    }
    if (choice === "link_mode") {
      antiLink.setMode(guildId, antiLink.getConfig(guildId).mode === "all" ? "invite" : "all");
      return goto("protection");
    }
    if (choice === "mention_toggle") {
      antiMention.setEnabled(guildId, !antiMention.getConfig(guildId).enabled);
      return goto("protection");
    }
    if (choice === "mention_threshold") {
      const steps = [3, 5, 8, 10, 15, 20];
      const current = antiMention.getConfig(guildId).maxMentions;
      antiMention.setMaxMentions(guildId, steps.find((n) => n > current) || steps[0]);
      return goto("protection");
    }
    // Les seuils défilent par paliers plutôt que d'ouvrir une fenêtre de
    // saisie : un clic suffit, et aucune valeur hors bornes ne peut être
    // saisie. Le dernier palier ramène au premier.
    if (choice === "spam_threshold") {
      const paliers = [
        { maxMessages: 3, windowSeconds: 5 },
        { maxMessages: 5, windowSeconds: 6 },
        { maxMessages: 6, windowSeconds: 6 },
        { maxMessages: 8, windowSeconds: 10 },
        { maxMessages: 10, windowSeconds: 15 },
      ];
      const actuel = automod.getConfig(guildId);
      const suivant =
        paliers.find((p) => p.maxMessages > actuel.maxMessages || (p.maxMessages === actuel.maxMessages && p.windowSeconds > actuel.windowSeconds)) ||
        paliers[0];
      automod.setThreshold(guildId, suivant.maxMessages, suivant.windowSeconds);
      return goto("protection");
    }
    if (choice === "spam_timeout") {
      const paliers = [30, 60, 120, 300, 600, 1800];
      const actuel = automod.getConfig(guildId).timeoutSeconds;
      automod.setTimeoutSeconds(guildId, paliers.find((n) => n > actuel) || paliers[0]);
      return goto("protection");
    }
    if (choice === "mention_timeout") {
      const paliers = [30, 60, 120, 300, 600, 1800];
      const actuel = antiMention.getConfig(guildId).timeoutSeconds;
      antiMention.setTimeoutSeconds(guildId, paliers.find((n) => n > actuel) || paliers[0]);
      return goto("protection");
    }
    // Ces deux-là ouvrent un sélecteur de salons : on mémorise seulement le
    // choix en cours, le rendu s'occupe d'afficher le bon menu.
    if (choice === "spam_exempt" || choice === "link_allow") {
      return goto("protection", { protectionAction: choice });
    }
    if (choice === "badwords_toggle") {
      badWords.setEnabled(guildId, !badWords.getConfig(guildId).enabled);
      return goto("protection");
    }
    // badwords_add / badwords_remove / whitelist_add / whitelist_remove : révèle le contrôle correspondant.
    return goto("protection", { protectionAction: choice });
  }

  // Sélecteurs de salons de la rubrique Protection. Le menu renvoie la liste
  // COMPLÈTE de ce qui doit être coché : on remplace donc l'ancienne liste au
  // lieu d'ajouter, sinon décocher un salon n'aurait aucun effet.
  if (action === "spamexempt" || action === "linkallow") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const choisis = interaction.values || [];
    if (action === "spamexempt") {
      for (const id of automod.getExemptChannels(guildId)) automod.setChannelExempt(guildId, id, false);
      for (const id of choisis) automod.setChannelExempt(guildId, id, true);
    } else {
      for (const id of antiLink.getAllowedChannels(guildId)) antiLink.setChannelAllowed(guildId, id, false);
      for (const id of choisis) antiLink.setChannelAllowed(guildId, id, true);
    }
    return goto("protection", { protectionAction: action === "spamexempt" ? "spam_exempt" : "link_allow" });
  }

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

  if (action === "wladd" || action === "wldel") {
    if (!can(member, "protection.whitelist")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "wladd") automod.addToWhitelist(guildId, "users", userId);
    else automod.removeFromWhitelist(guildId, "users", userId);
    return goto("protection");
  }

  if (action === "badwords" && extra === "del") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    badWords.removeWord(guildId, interaction.values[0]);
    return goto("protection");
  }

  if (action === "badwords" && extra === "add") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const word = interaction.fields.getTextInputValue("value").trim();
      if (!word) return interaction.reply({ content: "Mot vide, rien n'a été ajouté.", flags: MessageFlags.Ephemeral });
      const added = badWords.addWord(guildId, word);
      await interaction.reply({
        content: added ? `\`${word}\` ajouté à la liste.` : "Ce mot y était déjà.",
        flags: MessageFlags.Ephemeral,
      });
      return interaction.message?.edit(buildConfigPanel(guild, "protection", member)).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:badwords:add`).setTitle("Ajouter un mot interdit");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Mot à interdire").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "guardaction") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const choice = interaction.values[0];
    if (choice === "guard_toggle") {
      guardConfig.setEnabled(guildId, !guardConfig.getConfig(guildId).enabled);
      return goto("guard");
    }
    if (choice === "guard_punishment") {
      const next = { timeout: "kick", kick: "ban", ban: "timeout" }[guardConfig.getConfig(guildId).punishment];
      guardConfig.setPunishment(guildId, next);
      return goto("guard");
    }
    if (choice === "guard_autolockdown_toggle") {
      guardConfig.setAutoLockdown(guildId, !guardConfig.getConfig(guildId).autoLockdownOnCap);
      return goto("guard");
    }
    // guard_pick / guard_wl_add / guard_wl_remove : révèle le contrôle correspondant.
    return goto("guard", { guardAction: choice });
  }

  if (action === "guardpick") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("guard", { guardAction: "guard_pick", guardKey: interaction.values[0] });
  }

  if (action === "guardtoggle") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    guardConfig.toggleGuard(guildId, extra);
    return goto("guard", { guardAction: "guard_pick", guardKey: extra });
  }

  if (action === "guardwladd" || action === "guardwldel") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "guardwladd") guardWhitelist.add(guildId, "users", userId);
    else guardWhitelist.remove(guildId, "users", userId);
    return goto("guard");
  }

  if (action === "guardwlroleadd" || action === "guardwlroledel") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const roleId = interaction.values[0];
    if (action === "guardwlroleadd") guardWhitelist.add(guildId, "roles", roleId);
    else guardWhitelist.remove(guildId, "roles", roleId);
    return goto("guard");
  }

  if (action === "guardping") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    guardConfig.setPingRole(guildId, interaction.values[0] || null);
    return goto("guard");
  }

  if (action === "guardcreationlimit") {
    if (interaction.isModalSubmit()) {
      const raw = interaction.fields.getTextInputValue("duration").trim();
      if (!raw || raw.toLowerCase() === "off") {
        guardConfig.setCreationLimit(guildId, 0);
        await interaction.reply({ content: "Seuil de création de compte désactivé.", flags: MessageFlags.Ephemeral });
        return interaction.message?.edit(buildConfigPanel(guild, "guard", member)).catch(() => {});
      }
      const ms = parseDuration(raw);
      if (!ms) {
        return interaction.reply({ content: "Durée invalide — exemple : `7d`, ou `off` pour désactiver.", flags: MessageFlags.Ephemeral });
      }
      guardConfig.setCreationLimit(guildId, ms);
      await interaction.reply({ content: `Comptes créés il y a moins de **${raw}** sanctionnés à l'arrivée.`, flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "guard", member)).catch(() => {});
    }
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`${ID}:guardcreationlimit`).setTitle("Seuil de création de compte");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel('Durée (ex: 7d, 12h) ou "off"')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(20)
          .setRequired(false)
      )
    );
    return interaction.showModal(modal);
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

  if (action === "muterole") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    muteStore.setMuteRoleId(guildId, interaction.values[0] || null);
    return goto("mute");
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

  if (action === "voicehubchannel") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    voiceChannels.setHub(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicespawncategory") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    voiceChannels.setSpawnCategory(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicepanelchannel") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    voiceChannels.setPanelChannel(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicehubsetup") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (voiceHubSetup.isAlreadyConfigured(guild)) {
      return interaction.reply({ content: "Un générateur est déjà actif — change-le via le sélecteur plutôt que d'en recréer un.", flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    const { hubCategory, spawnCategory, hubChannel, panelChannel } = await voiceHubSetup.createVoiceHubSetup(guild);
    await interaction
      .followUp({
        content: `Configuration créée : ${hubCategory} > ${hubChannel} (rejoindre crée un salon), ${spawnCategory} pour les salons créés, et ${panelChannel} pour les gérer.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return interaction.message?.edit(buildConfigPanel(guild, "voice", member)).catch(() => {});
  }

  if (action === "voicepanelrefresh") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await interaction.deferUpdate();
    const ok = await voiceHubSetup.refreshPanelCard(guild);
    await interaction
      .followUp({
        content: ok ? "Panneau actualisé — les libellés/boutons repris sont ceux de la version actuelle du bot." : "Aucun salon-panneau configuré.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  if (action === "voicenames") {
    if (interaction.isModalSubmit()) {
      const voiceNameTemplate = interaction.fields.getTextInputValue("voice").trim();
      voiceChannels.setNameTemplates(guildId, { voiceNameTemplate });
      await interaction.reply({ content: "Modèle de nom enregistré.", flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "voice", member)).catch(() => {});
    }
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });

    const current = voiceChannels.getHubConfig(guildId);
    const modal = new ModalBuilder().setCustomId(`${ID}:voicenames`).setTitle("Modèle de nom des salons");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("voice")
          .setLabel("Nom du salon vocal créé ({pseudo})")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(90)
          .setRequired(true)
          .setValue(current.voiceNameTemplate)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "prefix") {
    if (interaction.isModalSubmit()) {
      const value = interaction.fields.getTextInputValue("value").trim();
      if (!value) {
        return interaction.reply({ content: "Préfixe vide, rien n'a été changé.", flags: MessageFlags.Ephemeral });
      }
      setPrefix(guildId, extra, value);
      await interaction.reply({
        content: `**${PREFIX_FIELDS[extra].label}** réglé sur \`${value}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return interaction.message?.edit(buildConfigPanel(guild, "prefixes", member)).catch(() => {});
    }

    const field = PREFIX_FIELDS[extra];
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

/**
 * Traite la soumission du Modal réduit (type d'événement + ID précis, voir
 * index.js) — cible/modérateur viennent de la carte (UserSelectMenu natif),
 * portés dans le customId du Modal, pas retapés ici.
 * @param {{ targetId: string|null, moderatorId: string|null }} [carried]
 */
async function handleHistorySearchModal(interaction, carried = {}) {
  if (!can(interaction.member, "logs.view")) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }
  const actionRaw = interaction.fields.getTextInputValue("action").trim();
  const idRaw = interaction.fields.getTextInputValue("id").trim();

  const results = historyStore.search(interaction.guild.id, {
    targetId: carried.targetId || undefined,
    moderatorId: carried.moderatorId || undefined,
    action: actionRaw || undefined,
    id: idRaw || undefined,
    limit: 10,
  });

  const resultContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Résultats de recherche\n${formatHistoryResults(results).slice(0, 3800)}`)
  );
  return interaction.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [resultContainer] });
}

module.exports = {
  buildConfigPanel, buildSectionSpec, handleConfigInteraction, handleHistorySearchModal, hasAnyPanelAccess, ID, SECTIONS };
