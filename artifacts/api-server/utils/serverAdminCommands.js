const {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { iconDe } = require("./emojiSlots");
const { carteConfirmationFichier } = require("./actionCard");
const { THEME_BLEU } = require("./dashboardImage");
const { can, peutGererNiveaux } = require("./permissions/engine");
const levelStore = require("./permissions/levelStore");
const { LEVEL_MIN, LEVEL_MAX } = require("./permissions/levelCatalog");
const accessStore = require("./accessStore");
const deroStore = require("./deroStore");
const { checkBotPermission, report } = require("./moderation/actions");
const roleLimitStore = require("./roleLimitStore");
const { majSure, banniereSurPanel } = require("./componentsV2");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text, { guildId: message.guild.id })] });

// Rendu des cartes (générique + listes paginées) : utils/listCard.js, partagé
// avec les listes en lecture seule d'utils/utilityCommands.js.
const { ID, card, buildListCard } = require("./listCard");
const readOnlyLists = require("./readOnlyLists");

const OWNERS_PAGE_SIZE = 10;

/** Carte dédiée de "&owners" — présentation demandée explicitement (titre couronné, compteur/page en évidence, liste numérotée). */
function buildOwnersCard(page, canEdit) {
  const items = accessStore.list("sys");
  const totalPages = Math.max(1, Math.ceil(items.length / OWNERS_PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  const slice = items.slice(clamped * OWNERS_PAGE_SIZE, clamped * OWNERS_PAGE_SIZE + OWNERS_PAGE_SIZE);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 👑 Liste Owner"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Utilisateur total :** \`${items.length}\`\n**Page :** \`${clamped + 1}/${totalPages}\``)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      slice.length
        ? slice.map((id, i) => `\`${String(clamped * OWNERS_PAGE_SIZE + i + 1).padStart(2, "0")}\`  <@${id}>  \`${id}\``).join("\n")
        : "*Aucun owner (rang sys).*"
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`srv:ownerspage:${clamped - 1}`).setLabel("Précédent").setStyle(ButtonStyle.Secondary).setDisabled(clamped === 0),
      new ButtonBuilder().setCustomId(`srv:ownerspage:${clamped + 1}`).setLabel("Suivant").setStyle(ButtonStyle.Secondary).setDisabled(clamped >= totalPages - 1)
    )
  );
  if (canEdit) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("srv:add:owners").setPlaceholder("Ajouter")));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("srv:del:owners").setPlaceholder("Retirer")));
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** &owners — gestion du rang sys, vue dédiée et paginée (voir aussi &panel > Rang sys). */
async function owners(client, message) {
  const isSys = accessStore.isAllowed("sys", message.author.id);
  const isOwner = accessStore.isOwner(message.author.id);
  if (!isSys && !isOwner) return;

  await message.reply(buildOwnersCard(0, isOwner));
}

/** Mention ou identifiant brut en tête d'arguments — même résolution que access() ci-dessus. */
function targetIdFromArgs(args) {
  const mentionMatch = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const idMatch = args[0]?.match(/^\d{15,25}$/);
  return mentionMatch?.[1] || idMatch?.[0] || null;
}

/**
 * "&sys <@membre|id>" — raccourci direct vers l'ajout au rang sys, sans
 * passer par la carte &owners (mêmes garde-fous : réservé au PROPRIÉTAIRE du
 * bot, jamais accordable par le rang sys lui-même — voir
 * utils/accessStore.js::NO_SYS_INHERIT). Le rang sys est un accès bot,
 * n'exige pas que la cible soit sur CE serveur.
 */
async function sysAdd(client, message, args) {
  if (!accessStore.isOwner(message.author.id)) return;
  const targetId = targetIdFromArgs(args);
  if (!targetId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `sys @membre`.");
  if (accessStore.isOwner(targetId)) return reply(message, "info", "Déjà propriétaire du bot — le rang sys n'ajouterait rien.");
  if (!accessStore.add("sys", targetId)) return reply(message, "info", `<@${targetId}> est déjà rang sys.`);
  return reply(message, "success", `<@${targetId}> a désormais le rang sys.`);
}

/** "&unsys <@membre|id>" — retire le rang sys. */
async function sysRemove(client, message, args) {
  if (!accessStore.isOwner(message.author.id)) return;
  const targetId = targetIdFromArgs(args);
  if (!targetId) return reply(message, "error", "Indique un membre (mention ou identifiant) : `unsys @membre`.");
  if (!accessStore.remove("sys", targetId)) return reply(message, "info", `<@${targetId}> n'a pas le rang sys.`);
  return reply(message, "success", `Rang sys retiré à <@${targetId}>.`);
}

/**
 * Carte "&access <@membre>" — assigne un NIVEAU individuel (1-9,
 * utils/permissions/levelStore.js) à UN membre précis — remplace l'ancien
 * octroi catégorie/clé par clé : un membre a désormais UN niveau, pas une
 * collection de clés cochées une à une.
 */
function buildAccessCard(guildId, memberId, memberTag) {
  const niveau = levelStore.getUserLevel(guildId, memberId);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Accès de ${memberTag}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(niveau ? `**Niveau individuel** : ${niveau}/9` : "*Aucun niveau individuel assigné.*")
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`srv:accesslevel:${memberId}`)
        .setPlaceholder("Choisir un niveau (1-9)")
        .addOptions(
          Array.from({ length: LEVEL_MAX - LEVEL_MIN + 1 }, (_, i) => LEVEL_MIN + i).map((n) =>
            new StringSelectMenuOptionBuilder().setLabel(`Niveau ${n}`).setValue(String(n)).setDefault(n === niveau)
          )
        )
    )
  );
  if (niveau) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`srv:accessclear:${memberId}`).setLabel("Retirer le niveau").setStyle(ButtonStyle.Danger)
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Carte de "=add"/"!!owner" — présentation demandée explicitement
 * (titre "Owner", "Utilisateur"/"Statut"/"Consulté par" en évidence), adaptée
 * au système à niveaux : "Statut" reflète le NIVEAU individuel réel de ce
 * membre — jamais le mot "Owner" tel quel, qui désignerait à tort le VRAI
 * rang propriétaire du bot (utils/accessStore.js), refusé plus haut avant
 * l'appel.
 */
function buildOwnerAccessCard(guildId, memberId, memberTag, consultePar, variante = "owner") {
  const niveau = levelStore.getUserLevel(guildId, memberId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Owner"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Utilisateur** — <@${memberId}>`,
        `**Statut** — ${niveau ? iconDe(guildId, "CHECK") : iconDe(guildId, "CROSS")} ${niveau ? `Niveau ${niveau}/9` : "Aucun niveau individuel"}`,
        `**Consulté par** — ${consultePar}`,
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`srv:${variante}level:${memberId}`)
        .setPlaceholder("Choisir un niveau (1-9)")
        .addOptions(
          Array.from({ length: LEVEL_MAX - LEVEL_MIN + 1 }, (_, i) => LEVEL_MIN + i).map((n) =>
            new StringSelectMenuOptionBuilder().setLabel(`Niveau ${n}`).setValue(String(n)).setDefault(n === niveau)
          )
        )
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * &access <@membre|id> — ouvre le panneau d'assignation de niveau pour CE
 * membre. `label` ne sert qu'au message d'erreur : "&owner"/"!!owner"
 * (préfixes séparés, voir les handlers dédiés ci-dessous) délèguent ici mais
 * doivent rappeler LEUR propre syntaxe ; `ownerStyle` fait poster la carte
 * "Owner" (buildOwnerAccessCard) au lieu de la carte générique — même
 * mécanisme de fond, présentation différente.
 */
async function access(client, message, args, label = "access", ownerStyle = false, variante = "owner") {
  if (!peutGererNiveaux(message.member)) return;

  const mentionMatch = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const idMatch = args[0]?.match(/^\d{15,25}$/);
  const targetId = mentionMatch?.[1] || idMatch?.[0];
  if (!targetId) return reply(message, "error", `Indique un membre (mention ou identifiant) : \`${label} @membre\`.`);

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) return reply(message, "error", "Ce membre n'est pas sur le serveur.");

  if (accessStore.isOwner(target.id) || accessStore.isSys(target.id)) {
    return reply(message, "info", `${target.user.tag} est déjà propriétaire/rang sys — accès complet, rien à accorder en plus.`);
  }

  if (ownerStyle) {
    return message.reply(buildOwnerAccessCard(message.guild.id, target.id, target.user.tag, message.author.tag, variante));
  }
  await message.reply(buildAccessCard(message.guild.id, target.id, target.user.tag));
}

/**
 * Legacy helper "&owner <@membre|id>" — carte "Owner" adaptée au système à
 * niveaux. La commande publique `&owner` reste réservée par le routeur à la
 * famille gestion ; ce helper reste exporté pour les anciennes interactions
 * internes.
 */
async function ownerModeration(client, message, args) {
  return access(client, message, args, "owner", true, "modowner");
}

/**
 * &allbots — lecture seule, réservée au rang sys (comme &sources). Le contenu
 * vient d'utils/readOnlyLists.js, exactement comme la pagination de la carte :
 * une seule définition, impossible que les deux se contredisent.
 */
async function allbots(client, message, args) {
  if (!can(message.member, "sys")) return;
  await readOnlyLists.ensureMembersCached(message.guild);
  const { title, description, items } = readOnlyLists.DEFINITIONS.bots.build(message.guild);
  const page = parseInt(args[0], 10) - 1 || 0;
  await message.reply(buildListCard({ idKind: "bots", title, description, items, page, canEdit: false }));
}

/** Traite les interactions du panneau générique liste paginée (customId "srv:page|add|del:..."). */
async function handleServerAdminInteraction(interaction) {
  const [, action, idKind, extra] = interaction.customId.split(":");

  // Pagination dédiée de "&owners" (boutons Précédent/Suivant, voir
  // buildOwnersCard) — routée à part car `idKind` porte ici un numéro de
  // page, pas le nom d'une liste comme pour "page"/"add"/"del" ci-dessous.
  if (action === "ownerspage") {
    const permission = accessStore.isAllowed("sys", interaction.user.id) || accessStore.isOwner(interaction.user.id);
    if (!permission) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return interaction.update(buildOwnersCard(parseInt(idKind, 10) || 0, accessStore.isOwner(interaction.user.id)));
  }

  // Panneau "&access <@membre>" (voir buildAccessCard) — `idKind` porte ici
  // l'identifiant du MEMBRE ciblé, pas le nom d'une liste. Assigner/retirer
  // un niveau est une action d'escalade potentielle : réservée au
  // propriétaire du bot (voir peutGererNiveaux), jamais déléguée au rang sys.
  if (action === "accesslevel" || action === "accessclear") {
    if (!peutGererNiveaux(interaction.member)) {
      return interaction.reply({ content: "Réservé au propriétaire du bot.", flags: MessageFlags.Ephemeral });
    }
    const memberId = idKind;
    const target = await interaction.guild.members.fetch(memberId).catch(() => null);
    const tag = target?.user?.tag || `<@${memberId}>`;

    if (action === "accesslevel") {
      levelStore.setUserLevel(interaction.guild.id, memberId, parseInt(interaction.values[0], 10));
    } else {
      levelStore.setUserLevel(interaction.guild.id, memberId, null);
    }
    return interaction.update(buildAccessCard(interaction.guild.id, memberId, tag));
  }

  // Panneau "Owner" (voir buildOwnerAccessCard) — 2 variantes du MÊME
  // mécanisme sur 2 customId distincts : "ownerlevel" = catalogue complet,
  // "modownerlevel" = legacy "&owner" (modération). "Consulté par" reflète
  // TOUJOURS qui clique maintenant, pas qui a tapé la commande au départ.
  const VARIANTES_OWNER = { ownerlevel: "owner", modownerlevel: "modowner" };
  if (VARIANTES_OWNER[action]) {
    if (!peutGererNiveaux(interaction.member)) {
      return interaction.reply({ content: "Réservé au propriétaire du bot.", flags: MessageFlags.Ephemeral });
    }
    const variante = VARIANTES_OWNER[action];
    const memberId = idKind;
    const target = await interaction.guild.members.fetch(memberId).catch(() => null);
    const tag = target?.user?.tag || `<@${memberId}>`;

    levelStore.setUserLevel(interaction.guild.id, memberId, parseInt(interaction.values[0], 10));
    return interaction.update(buildOwnerAccessCard(interaction.guild.id, memberId, tag, interaction.user.tag, variante));
  }

  const LISTS = {
    owners: {
      permission: () => accessStore.isAllowed("sys", interaction.user.id) || accessStore.isOwner(interaction.user.id),
      canEdit: () => accessStore.isOwner(interaction.user.id),
      title: "Liste des owners (rang sys)",
      description: "Le rang sys donne accès à tout le bot. Seul le propriétaire du bot peut ajouter ou retirer.",
      items: () => accessStore.list("sys").map((id) => `<@${id}> (${id})`),
      add: (userId) => accessStore.add("sys", userId),
      del: (userId) => accessStore.remove("sys", userId),
    },
  };

  // Les listes en LECTURE SEULE (bots, admins, boosters, membres d'un rôle —
  // voir utils/readOnlyLists.js) n'ont ni ajout ni retrait, mais elles
  // doivent bien changer de page : sans ce branchement, leur sélecteur de
  // page restait décoratif et le clic ne faisait rien.
  const [readOnlyKind, readOnlyArg] = idKind.split("/");
  const readOnly = readOnlyLists.DEFINITIONS[readOnlyKind];
  if (readOnly) {
    if (action !== "page") return;
    if (readOnly.permission && !readOnly.permission(interaction.member)) {
      return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    }
    // Le cache peut être froid ici (redémarrage du bot depuis l'envoi de la
    // carte) : sans ça, la page 2 d'une vieille carte serait tronquée.
    await readOnlyLists.ensureMembersCached(interaction.guild);
    const built = readOnly.build(interaction.guild, readOnlyArg);
    if (!built) return interaction.reply({ content: "Cette liste n'existe plus.", flags: MessageFlags.Ephemeral });
    return interaction.update(
      buildListCard({ idKind, title: built.title, description: built.description, items: built.items, page: parseInt(interaction.values[0], 10) || 0, canEdit: false })
    );
  }

  const list = LISTS[idKind];
  if (!list) return;
  if (!list.permission()) {
    return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
  }

  let page = 0;
  if (action === "page") {
    page = parseInt(interaction.values[0], 10) || 0;
  } else if (action === "add" || action === "del") {
    if (!list.canEdit()) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (accessStore.isOwner(userId) && idKind === "owners") {
      return interaction.reply({ content: `<@${userId}> est propriétaire du bot, déjà tous les accès.`, flags: MessageFlags.Ephemeral });
    }
    const changed = action === "add" ? list.add(userId) : list.del(userId);
    if (!changed) {
      return interaction.reply({
        content: action === "add" ? `<@${userId}> y était déjà.` : `<@${userId}> n'y était pas.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (idKind === "owners") {
    return interaction.update(buildOwnersCard(page, list.canEdit()));
  }

  return interaction.update(
    buildListCard({ idKind, title: list.title, description: list.description, items: list.items(), page, canEdit: list.canEdit() })
  );
}

// --- &role create/delete/rename/color/admin (gestion du rôle lui-même,
// distinct de &addrole/&delrole qui gèrent l'appartenance d'un membre — voir
// utils/moderationCommands.js) ---

const ROLE_ADMIN_SUBCOMMANDS = new Set(["create", "delete", "rename", "color", "admin"]);

function botCanManageRole(guild, role) {
  return guild.members.me.roles.highest.position > role.position;
}

// Confirmation générique pour une action destructrice/sensible (suppression
// de rôle ou de salon, don d'Administrateur) : un clic ne suffit jamais.
// `execute` n'est rappelé qu'après confirmation ET revérification des
// droits — la situation a pu changer pendant que le panneau attendait.
const pendingConfirms = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;

function rememberConfirm(data) {
  const now = Date.now();
  for (const [key, value] of pendingConfirms) {
    if (now - value.at > PENDING_TTL_MS) pendingConfirms.delete(key);
  }
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  pendingConfirms.set(token, { ...data, at: now });
  return token;
}

/**
 * Construit la fonction de terminaison passée à chaque `execute` : appelée
 * avec (titre, corps) une fois l'action faite, elle décide comment le dire.
 * Sans `retour` (commande tapée en texte, jamais lancée depuis un panel) :
 * comportement inchangé, une carte isolée. AVEC `retour` (message.retour,
 * voir utils/configPanel.js::messageFromInteraction) : revient sur le panel
 * d'origine, résultat affiché en bannière — même mécanisme que la
 * confirmation à UN temps (rolecreate/renamerole/roledelete), appliqué ici
 * au second temps (le VRAI "Confirmer"/"Annuler").
 * @param {import('discord.js').Interaction} interaction
 * @param {((i: import('discord.js').Interaction) => object)|undefined} retour
 */
function construireTerminaison(interaction, retour) {
  return (title, body) => {
    if (!retour) return interaction.update(card(title, body));
    const texte = body ? `## ${title}\n${body}` : `## ${title}`;
    return majSure(interaction, banniereSurPanel(retour(interaction), texte));
  };
}

/**
 * Demande une confirmation à deux temps. `carte` (facultatif) remplace le
 * corps texte par une carte dessinée (utils/actionCard.js) : même monde
 * visuel que les cartes de sanction. Le repli sur le texte est délibéré — une
 * confirmation qui ne s'affiche pas rendrait l'action impossible à lancer.
 * `execute` reçoit désormais `(interaction, terminer)` : `terminer(titre,
 * corps)` remplace un `interaction.update(card(...))` direct, pour que le
 * résultat revienne sur le panel d'origine s'il y en a un (voir
 * construireTerminaison ci-dessus) — jamais d'appel direct à
 * `interaction.update` dans un `execute` pour le résultat FINAL.
 */
function requestConfirmation(message, { title, body, confirmLabel, permission, execute, carte }) {
  const token = rememberConfirm({ actorId: message.author.id, permission, execute, retour: message.retour });
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ID}:confirm:go:${token}`).setLabel(confirmLabel).setStyle(ButtonStyle.Danger).setEmoji(iconDe(message.guild.id, "CHECK")),
    new ButtonBuilder().setCustomId(`${ID}:confirm:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary).setEmoji(iconDe(message.guild.id, "CROSS"))
  );

  if (carte) {
    const fichier = carteConfirmationFichier(carte, "confirmation.png");
    if (fichier) {
      const container = new ContainerBuilder().setAccentColor(0x2c2f5c);
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL("attachment://confirmation.png"))
      );
      container.addActionRowComponents(boutons);
      return message.reply({ flags: MessageFlags.IsComponentsV2, components: [container], files: [fichier] });
    }
  }

  return message.reply(card(title, body, [boutons]));
}

async function handleConfirmInteraction(interaction) {
  const [, , action, token] = interaction.customId.split(":"); // srv:confirm:go|no:TOKEN
  const pending = pendingConfirms.get(token);
  // Jeton introuvable (expiré ou déjà consommé) : aucun `retour` à
  // récupérer, la carte isolée reste le seul choix possible ici.
  if (!pending) return interaction.update(card("Expiré", "Relance la commande pour recommencer."));
  if (interaction.user.id !== pending.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }
  pendingConfirms.delete(token);
  const terminer = construireTerminaison(interaction, pending.retour);

  if (action === "no") return terminer("Annulé", null);

  if (!can(interaction.member, pending.permission)) {
    return terminer("Accès refusé", "Tu n'as plus ce droit.");
  }
  await pending.execute(interaction, terminer);
}

async function roleAdmin(client, message, args) {
  const sub = args[0].toLowerCase();
  // Mention OU ID pour le rôle (règle du cahier des charges) : les IDs
  // bruts après le mot de sous-commande sont résolus en cache si aucune
  // mention n'a été donnée.
  const roleIdArg = args.slice(1).find((a) => /^\d{15,25}$/.test(a));
  const role = message.mentions.roles?.first() || (roleIdArg ? message.guild.roles.cache.get(roleIdArg) : null);

  if (sub === "create") {
    if (!can(message.member, "server.roles.manage")) return;
    const name = args.slice(1).join(" ").trim();
    if (!name) return reply(message, "error", "Indique un nom : `role create <nom>`.");
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    let created;
    try {
      created = await message.guild.roles.create({ name, reason: `Rôle créé par ${message.author.tag}` });
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Rôle créé",
      fields: [{ label: "Rôle", value: `${created.name} (${created.id})` }],
      action: "role_create",
      targetId: created.id,
      targetTag: created.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Rôle **${created.name}** créé.`);
  }

  if (!role) return reply(message, "error", `Indique un rôle : \`role ${sub} @rôle ...\`.`);

  if (sub === "delete") {
    if (!can(message.member, "server.roles.manage")) return;
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const roleId = role.id;
    const name = role.name;
    return requestConfirmation(message, {
      title: `Supprimer le rôle ${name} ?`,
      body: `**${name}** (${roleId})\n\nCette action est définitive et ne peut pas être annulée.`,
      carte: {
        titre: `Supprimer le rôle ${name} ?`,
        // Rouge de la refonte visuelle (utils/dashboardImage.js::THEME_BLEU
        // .danger) — même teinte que les autres alertes/confirmations
        // dangereuses du bot, plutôt qu'un rouge isolé propre à ce fichier.
        couleur: THEME_BLEU.danger,
        lignes: [
          { label: "Rôle", valeur: name, couleur: role.color ? `#${role.color.toString(16).padStart(6, "0")}` : undefined },
          { label: "Identifiant", valeur: roleId },
          // Le nombre de membres qui perdront ce rôle est l'information qui
          // fait vraiment hésiter : elle manquait au message texte.
          { label: "Membres concernés", valeur: String(role.members?.size ?? 0) },
        ],
        avertissement: "Cette action est définitive et ne peut pas être annulée.",
      },
      confirmLabel: "Supprimer",
      permission: "server.roles.manage",
      execute: async (interaction, terminer) => {
        const fresh = interaction.guild.roles.cache.get(roleId);
        if (!fresh) return terminer("Rôle introuvable", "Ce rôle n'existe déjà plus.");
        try {
          await fresh.delete(`Rôle supprimé par ${interaction.user.tag}`);
        } catch (err) {
          return terminer("Action impossible", `Discord a refusé : ${err.message}`);
        }
        await report(interaction.client, {
          guildId: interaction.guild.id,
          category: "server",
          title: "Rôle supprimé",
          fields: [{ label: "Rôle", value: `${name} (${roleId})` }],
          action: "role_delete",
          targetId: roleId,
          targetTag: name,
          moderator: interaction.user,
          channelId: interaction.channelId,
        });
        return terminer("Terminé", `Rôle **${name}** supprimé.`);
      },
    });
  }

  if (sub === "rename") {
    if (!can(message.member, "server.roles.manage")) return;
    const newName = args.slice(2).join(" ").trim();
    if (!newName) return reply(message, "error", "Indique le nouveau nom : `role rename @rôle <nom>`.");
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const oldName = role.name;
    try {
      await role.setName(newName, `Renommé par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Rôle mis à jour",
      fields: [{ label: "Rôle", value: `${newName} (${role.id})` }, { label: "Nom", value: `${oldName} → ${newName}` }],
      action: "role_rename",
      targetId: role.id,
      targetTag: newName,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Rôle renommé **${oldName}** → **${newName}**.`);
  }

  if (sub === "color") {
    if (!can(message.member, "server.roles.manage")) return;
    const hex = args[2];
    if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return reply(message, "error", "Indique une couleur hexadécimale : `role color @rôle #ff0000`.");
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const color = hex.startsWith("#") ? hex : `#${hex}`;
    try {
      await role.setColor(color, `Couleur changée par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Rôle mis à jour",
      fields: [{ label: "Rôle", value: `${role.name} (${role.id})` }, { label: "Couleur", value: color }],
      action: "role_color",
      targetId: role.id,
      targetTag: role.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Couleur de **${role.name}** réglée sur **${color}**.`);
  }

  if (sub === "admin") {
    // Réservé au rang sys/propriétaire, jamais délégable par rôle (voir
    // "roleGrantable: false" dans utils/permissions/catalog.js) : c'est la
    // commande la plus sensible du bot, confirmation obligatoire.
    if (!can(message.member, "server.roles.admin_grant")) return;
    const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
    if (botPerm) return reply(message, "error", botPerm);
    if (!botCanManageRole(message.guild, role)) {
      return reply(message, "error", "Mon rôle est trop bas pour gérer ce rôle — place-le plus haut dans la liste des rôles.");
    }
    const roleId = role.id;
    const name = role.name;
    const grant = !role.permissions.has(PermissionFlagsBits.Administrator);
    return requestConfirmation(message, {
      title: `Confirmer : ${grant ? "donner" : "retirer"} Administrateur`,
      body: [
        `Rôle : **${name}** (${roleId})`,
        "",
        grant
          ? "**Administrateur donne un accès total au serveur** à quiconque a ce rôle. Confirme que c'est voulu."
          : "Ce rôle a actuellement la permission Administrateur — la lui retirer ?",
      ].join("\n"),
      confirmLabel: grant ? "Donner Administrateur" : "Retirer",
      permission: "server.roles.admin_grant",
      execute: async (interaction, terminer) => {
        const fresh = interaction.guild.roles.cache.get(roleId);
        if (!fresh) return terminer("Rôle introuvable", "Ce rôle n'existe plus.");
        try {
          const next = grant ? fresh.permissions.add(PermissionFlagsBits.Administrator) : fresh.permissions.remove(PermissionFlagsBits.Administrator);
          await fresh.setPermissions(next, `${grant ? "Administrateur donné" : "Administrateur retiré"} par ${interaction.user.tag}`);
        } catch (err) {
          return terminer("Action impossible", `Discord a refusé : ${err.message}`);
        }
        await report(interaction.client, {
          guildId: interaction.guild.id,
          category: "server",
          title: grant ? "Administrateur donné à un rôle" : "Administrateur retiré d'un rôle",
          fields: [{ label: "Rôle", value: `${name} (${roleId})` }],
          action: grant ? "role_admin_grant" : "role_admin_revoke",
          targetId: roleId,
          targetTag: name,
          moderator: interaction.user,
          channelId: interaction.channelId,
        });
        return terminer("Terminé", `Administrateur ${grant ? "donné à" : "retiré de"} **${name}**.`);
      },
    });
  }
}

/**
 * &limitrole <rôle> [nombre] — plafonne le nombre de membres pouvant avoir un
 * rôle (rôle "prestige", places limitées). Sans nombre, affiche le plafond
 * actuel ; `off` le retire. Garde-fou côté bot uniquement (utils/
 * roleLimitStore.js), vérifié par &addrole et &autorole — pas une règle
 * Discord native, donc sans effet sur les membres qui l'ont déjà.
 */
async function limitRole(client, message, args) {
  if (!can(message.member, "server.roles.manage")) return;
  const role = message.mentions.roles?.first() || (args[0] && message.guild.roles.cache.get(args[0].replace(/\D/g, "")));
  if (!role) return reply(message, "error", "Indique un rôle (mention ou ID) : `limitrole @rôle <nombre>`.");

  const valeur = args.find((a) => a !== role.toString() && a !== role.id);
  if (!valeur) {
    const limite = roleLimitStore.getLimit(message.guild.id, role.id);
    return reply(
      message,
      "info",
      limite == null
        ? `Aucune limite sur **${role.name}** (${role.members.size} membre(s) actuellement).`
        : `**${role.name}** est limité à **${limite}** membre(s) — ${role.members.size}/${limite} actuellement.`
    );
  }
  if (valeur.toLowerCase() === "off") {
    roleLimitStore.clearLimit(message.guild.id, role.id);
    return reply(message, "success", `Limite retirée sur **${role.name}**.`);
  }
  const nombre = parseInt(valeur, 10);
  if (!Number.isInteger(nombre) || nombre < 1) return reply(message, "error", "Indique un nombre entier positif, ou `off` pour retirer la limite.");
  roleLimitStore.setLimit(message.guild.id, role.id, nombre);
  return reply(
    message,
    "success",
    `**${role.name}** limité à **${nombre}** membre(s) (${role.members.size}/${nombre} actuellement — les membres déjà présents ne sont pas retirés).`
  );
}

// --- &channel create/delete/rename/topic ---

const CHANNEL_ADMIN_SUBCOMMANDS = new Set(["create", "delete", "rename", "topic"]);

async function channelAdmin(client, message, args) {
  if (!can(message.member, "server.channels.manage")) return;
  const sub = (args[0] || "").toLowerCase();
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
  if (botPerm) return reply(message, "error", botPerm);

  if (sub === "create") {
    const isVoice = args[1]?.toLowerCase() === "vocal";
    const name = args.slice(isVoice ? 2 : 1).join(" ").trim();
    if (!name) return reply(message, "error", "Indique un nom : `channel create <nom> [vocal]`.");
    let created;
    try {
      created = await message.guild.channels.create({
        name,
        type: isVoice ? ChannelType.GuildVoice : ChannelType.GuildText,
        reason: `Salon créé par ${message.author.tag}`,
      });
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Salon créé",
      fields: [{ label: "Salon", value: `<#${created.id}> (${created.id})` }],
      action: "channel_create",
      targetId: created.id,
      targetTag: created.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Salon **${created.name}** créé.`);
  }

  // Mention, ID, ou salon courant par défaut (règle du cahier des charges :
  // mention ou ID pour les paramètres de salon).
  const channelIdArg = args.slice(1).find((a) => /^\d{15,25}$/.test(a));
  const target = message.mentions.channels?.first() || (channelIdArg && message.guild.channels.cache.get(channelIdArg)) || message.channel;

  if (sub === "delete") {
    const name = target.name;
    const id = target.id;
    return requestConfirmation(message, {
      title: `Supprimer le salon ${name} ?`,
      body: `**${name}** (${id})\n\nCette action est définitive et l'historique du salon part avec.`,
      confirmLabel: "Supprimer",
      permission: "server.channels.manage",
      execute: async (interaction, terminer) => {
        const fresh = interaction.guild.channels.cache.get(id);
        if (!fresh) return terminer("Salon introuvable", "Ce salon n'existe déjà plus.");
        try {
          await fresh.delete(`Salon supprimé par ${interaction.user.tag}`);
        } catch (err) {
          return terminer("Action impossible", `Discord a refusé : ${err.message}`);
        }
        await report(interaction.client, {
          guildId: interaction.guild.id,
          category: "server",
          title: "Salon supprimé",
          fields: [{ label: "Salon", value: `${name} (${id})` }],
          action: "channel_delete",
          targetId: id,
          targetTag: name,
          moderator: interaction.user,
          channelId: interaction.channelId === id ? null : interaction.channelId,
        });
        // Le salon qui portait la confirmation peut avoir disparu avec la
        // suppression (si on a confirmé depuis le salon ciblé lui-même).
        return terminer("Terminé", `Salon **${name}** supprimé.`).catch(() => {});
      },
    });
  }

  if (sub === "rename") {
    const rest = args.filter((a) => !a.startsWith("<#") && a !== channelIdArg).slice(1);
    const newName = rest.join(" ").trim();
    if (!newName) return reply(message, "error", "Indique le nouveau nom : `channel rename [#salon|id] <nom>`.");
    const oldName = target.name;
    try {
      await target.setName(newName, `Renommé par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Salon mis à jour",
      fields: [{ label: "Salon", value: `<#${target.id}> (${target.id})` }, { label: "Nom", value: `${oldName} → ${newName}` }],
      action: "channel_rename",
      targetId: target.id,
      targetTag: newName,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Salon renommé **${oldName}** → **${newName}**.`);
  }

  if (sub === "topic") {
    if (!("setTopic" in target)) return reply(message, "error", "Ce type de salon n'a pas de topic.");
    const rest = args.filter((a) => !a.startsWith("<#") && a !== channelIdArg).slice(1);
    const topic = rest.join(" ").trim();
    try {
      await target.setTopic(topic || null, `Topic changé par ${message.author.tag}`);
    } catch (err) {
      return reply(message, "error", `Discord a refusé : ${err.message}`);
    }
    await report(client, {
      guildId: message.guild.id,
      category: "server",
      title: "Salon mis à jour",
      fields: [{ label: "Salon", value: `<#${target.id}> (${target.id})` }, { label: "Topic", value: topic || "*retiré*" }],
      action: "channel_topic",
      targetId: target.id,
      targetTag: target.name,
      moderator: message.author,
      channelId: message.channel.id,
    });
    return reply(message, "success", `Topic de <#${target.id}> mis à jour.`);
  }

  return reply(message, "error", "Utilise `channel create|delete|rename|topic ...`.");
}

// --- &dero : permissions automatiques sur chaque nouveau salon ---

async function dero(client, message, args) {
  if (!can(message.member, "server.dero.manage")) return;
  const sub = (args[0] || "").toLowerCase();
  const guildId = message.guild.id;

  if (sub === "off") {
    for (const roleId of deroStore.getRoles(guildId)) deroStore.removeRole(guildId, roleId);
    return reply(message, "success", "Dero automatique désactivé.");
  }

  if (sub === "role") {
    const role = message.mentions.roles?.first();
    if (!role) return reply(message, "error", "Indique un rôle : `dero role @rôle`.");
    const removed = deroStore.removeRole(guildId, role.id);
    if (!removed) deroStore.addRole(guildId, role.id);
    return reply(message, "success", removed ? `**${role.name}** retiré du dero automatique.` : `**${role.name}** ajouté au dero automatique.`);
  }

  const roles = deroStore.getRoles(guildId);
  const lines = roles.length ? roles.map((id) => `<@&${id}>`).join(", ") : "*aucun*";
  await message.reply({
    embeds: [
      buildStatusEmbed(
        "info",
        [
          `> **Rôles** : ${lines}`,
          "> Applique Voir le salon/Envoyer des messages/Se connecter à chaque nouveau salon créé.",
          "",
          "`dero role @rôle` pour ajouter/retirer, `dero off` pour tout désactiver.",
        ].join("\n"),
        { title: "Dero automatique", guildId }
      ),
    ],
  });
}

/** À appeler dans l'écouteur "channelCreate" du client (voir index.js). */
async function applyDeroToNewChannel(channel) {
  if (!channel.guild || !channel.permissionOverwrites) return;
  const roles = deroStore.getRoles(channel.guild.id);
  if (!roles.length) return;
  for (const roleId of roles) {
    const role = channel.guild.roles.cache.get(roleId);
    if (!role) continue;
    await channel.permissionOverwrites
      .edit(role, { ViewChannel: true, SendMessages: true, Connect: true }, { reason: "Dero automatique" })
      .catch((err) => console.error("[dero] échec sur", channel.id, err.message));
  }
}

module.exports = {
  owners,
  access,
  ownerModeration,
  sysAdd,
  sysRemove,
  allbots,
  handleServerAdminInteraction,
  roleAdmin,
  limitRole,
  channelAdmin,
  dero,
  applyDeroToNewChannel,
  handleConfirmInteraction,
  requestConfirmation,
  ROLE_ADMIN_SUBCOMMANDS,
  CHANNEL_ADMIN_SUBCOMMANDS,
  ID,
};
