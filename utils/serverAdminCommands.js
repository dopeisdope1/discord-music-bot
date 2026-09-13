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
const { EMOJI } = require("./emojis");
const { carteConfirmationFichier } = require("./actionCard");
const { can } = require("./permissions/engine");
const permStore = require("./permissions/store");
const permCatalog = require("./permissions/catalog");
const accessStore = require("./accessStore");
const automod = require("./automod/antiSpam");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const deroStore = require("./deroStore");
const voiceChannels = require("./voiceChannels");
const { checkBotPermission, report } = require("./moderation/actions");
const { parseDuration } = require("./moderationCommands");
const roleLimitStore = require("./roleLimitStore");
const { getPrefixes } = require("./prefixStore");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

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

/**
 * Carte "&access <@membre>" — octroi de permissions INDIVIDUELLES à UN
 * membre précis (utils/permissions/store.js::grantToUser/revokeFromUser),
 * même catalogue que &panel > Rôles et permissions (utils/permissions/
 * catalog.js) mais côté MEMBRE plutôt que côté rôle. Choisir une catégorie
 * révèle ses clés ; en choisir une la bascule tout de suite (accordée <->
 * retirée) — un seul aller-retour, pas de brouillon à confirmer.
 */
function buildAccessCard(guildId, memberId, memberTag, category = null) {
  const granted = permStore.getUserGrants(guildId, memberId);
  const groupes = permCatalog
    .byCategory()
    .map((g) => {
      const accordees = g.permissions.filter((p) => granted.includes(p.key));
      return accordees.length ? `**${g.label}** : ${accordees.map((p) => `\`${p.key}\``).join(", ")}` : null;
    })
    .filter(Boolean);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Accès de ${memberTag}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**${granted.length}** permission(s) individuelle(s) accordée(s)\n${groupes.length ? groupes.join("\n") : "*Aucune.*"}`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`srv:accesscat:${memberId}`)
        .setPlaceholder("Choisir une catégorie")
        .addOptions(
          permCatalog
            .byCategory()
            .map((g) => new StringSelectMenuOptionBuilder().setLabel(g.label).setValue(g.category).setDefault(g.category === category))
        )
    )
  );

  const groupeOuvert = category && permCatalog.byCategory().find((g) => g.category === category);
  if (groupeOuvert) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`srv:accesskey:${memberId}:${category}`)
          .setPlaceholder(`Activer/désactiver — ${groupeOuvert.label}`)
          .addOptions(
            groupeOuvert.permissions.slice(0, 25).map((p) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(p.label.slice(0, 100))
                .setValue(p.key)
                .setDescription(granted.includes(p.key) ? "Actuellement accordée" : "Actuellement non accordée")
            )
          )
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Carte de "=owner" — présentation demandée explicitement (titre "Owner",
 * "Utilisateur"/"Statut"/"Consulté par" en évidence, liste numérotée des
 * accès, comme la capture d'un autre bot). Même mécanisme de fond que
 * buildAccessCard (mêmes permStore/permCatalog, catégorie -> clé) : "Statut"
 * reflète l'état RÉEL d'accès individuel de ce membre — jamais le mot
 * "Owner" tel quel, qui désignerait à tort le VRAI rang propriétaire du bot
 * (utils/accessStore.js), refusé plus haut dans handleAccessGrantTextCommand.
 */
function buildOwnerAccessCard(guildId, memberId, memberTag, consultePar, category = null) {
  const granted = permStore.getUserGrants(guildId, memberId);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Owner"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Utilisateur** — <@${memberId}>`,
        `**Statut** — ${granted.length ? EMOJI.CHECK : EMOJI.CROSS} ${granted.length ? "Accès individuel actif" : "Aucun accès individuel"}`,
        `**Consulté par** — ${consultePar}`,
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Accès attribués — ${granted.length}**`,
        "",
        granted.length
          ? granted.map((key, i) => `\`${String(i + 1).padStart(2, "0")}\` — ${permCatalog.label(key)}`).join("\n")
          : "*Aucun accès individuel pour l'instant.*",
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`srv:ownercat:${memberId}`)
        .setPlaceholder("Choisir une catégorie")
        .addOptions(
          permCatalog
            .byCategory()
            .map((g) => new StringSelectMenuOptionBuilder().setLabel(g.label).setValue(g.category).setDefault(g.category === category))
        )
    )
  );

  const groupeOuvert = category && permCatalog.byCategory().find((g) => g.category === category);
  if (groupeOuvert) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`srv:ownerkey:${memberId}:${category}`)
          .setPlaceholder(`Ajouter ou retirer un accès — ${groupeOuvert.label}`)
          .addOptions(
            groupeOuvert.permissions.slice(0, 25).map((p) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(p.label.slice(0, 100))
                .setValue(p.key)
                .setDescription(granted.includes(p.key) ? "Actuellement accordée" : "Actuellement non accordée")
            )
          )
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * &access <@membre|id> — ouvre le panneau d'octroi de permissions
 * individuelles pour CE membre. `label` ne sert qu'au message d'erreur :
 * "=add"/"=owner" (préfixe séparé, voir handleAccessGrantTextCommand) délèguent ici
 * mais doit rappeler SA propre syntaxe ; `ownerStyle` fait poster la carte
 * "Owner" (buildOwnerAccessCard) au lieu de la carte générique — même
 * mécanisme de fond, présentation différente.
 */
async function access(client, message, args, label = "access", ownerStyle = false) {
  if (!can(message.member, "panel.permissions.manage")) return;

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
    return message.reply(buildOwnerAccessCard(message.guild.id, target.id, target.user.tag, message.author.tag));
  }
  await message.reply(buildAccessCard(message.guild.id, target.id, target.user.tag));
}

/**
 * "=add <@membre|id>" ET "=owner <@membre|id>" — mêmes deux mots, même
 * mécanisme, même carte (buildOwnerAccessCard) : le VRAI catalogue de
 * permissions (utils/permissions/catalog.js), sur un préfixe séparé exprès
 * (demande explicite). Les commandes visibles sur la capture qui a inspiré
 * cette demande (follow, pv, wakeup, dog, bringall, mv+find+join...)
 * appartiennent à un AUTRE bot et n'existent pas ici : accorder l'une des
 * permissions RÉELLES de ce catalogue reste la seule chose que ce bot
 * puisse faire, donc c'est ce qui s'affiche — jamais un accès inventé, et
 * jamais confondu avec le transfert de propriété d'un salon vocal temporaire
 * (notion sans rapport, voir "&voc transfer @membre" pour CE besoin-là).
 */
async function handleAccessGrantTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const { owner: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
  const mot = (cmd || "").toLowerCase();
  if (mot !== "add" && mot !== "owner") return; // mot inconnu sur ce préfixe : silence

  return access(client, message, args, mot, true);
}

/** &whitelist — exemptés de l'anti-spam (voir aussi &panel > Protection). */
async function whitelist(client, message) {
  if (!can(message.member, "protection.whitelist")) return;
  const items = automod.getWhitelist(message.guild.id).users.map((id) => `<@${id}> (${id})`);
  await message.reply(
    buildListCard({
      idKind: "whitelist",
      title: "Liste WL (anti-spam)",
      description: "Ces membres sont exemptés de l'anti-spam/anti-flood.",
      items,
      page: 0,
      canEdit: true,
    })
  );
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
  // l'identifiant du MEMBRE ciblé, pas le nom d'une liste.
  if (action === "accesscat" || action === "accesskey") {
    if (!can(interaction.member, "panel.permissions.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const memberId = idKind;
    const target = await interaction.guild.members.fetch(memberId).catch(() => null);
    const tag = target?.user?.tag || `<@${memberId}>`;

    if (action === "accesscat") {
      return interaction.update(buildAccessCard(interaction.guild.id, memberId, tag, interaction.values[0]));
    }

    // action === "accesskey" : `extra` porte la catégorie ouverte, la valeur choisie est la clé à basculer.
    const category = extra;
    const key = interaction.values[0];
    const granted = permStore.getUserGrants(interaction.guild.id, memberId);
    if (granted.includes(key)) permStore.revokeFromUser(interaction.guild.id, memberId, key);
    else permStore.grantToUser(interaction.guild.id, memberId, key);
    return interaction.update(buildAccessCard(interaction.guild.id, memberId, tag, category));
  }

  // Panneau "=owner <@membre>" (voir buildOwnerAccessCard) — même mécanisme
  // que "accesscat"/"accesskey" ci-dessus, présentation "Owner" séparée.
  // "Consulté par" reflète TOUJOURS qui clique maintenant, pas qui a tapé
  // "=owner" au départ — aucun état à porter dans le customId pour ça.
  if (action === "ownercat" || action === "ownerkey") {
    if (!can(interaction.member, "panel.permissions.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const memberId = idKind;
    const target = await interaction.guild.members.fetch(memberId).catch(() => null);
    const tag = target?.user?.tag || `<@${memberId}>`;

    if (action === "ownercat") {
      return interaction.update(buildOwnerAccessCard(interaction.guild.id, memberId, tag, interaction.user.tag, interaction.values[0]));
    }

    const category = extra;
    const key = interaction.values[0];
    const granted = permStore.getUserGrants(interaction.guild.id, memberId);
    if (granted.includes(key)) permStore.revokeFromUser(interaction.guild.id, memberId, key);
    else permStore.grantToUser(interaction.guild.id, memberId, key);
    return interaction.update(buildOwnerAccessCard(interaction.guild.id, memberId, tag, interaction.user.tag, category));
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
    whitelist: {
      permission: () => can(interaction.member, "protection.whitelist"),
      canEdit: () => true,
      title: "Liste WL (anti-spam)",
      description: "Ces membres sont exemptés de l'anti-spam/anti-flood.",
      items: () => automod.getWhitelist(interaction.guild.id).users.map((id) => `<@${id}> (${id})`),
      add: (userId) => automod.addToWhitelist(interaction.guild.id, "users", userId),
      del: (userId) => automod.removeFromWhitelist(interaction.guild.id, "users", userId),
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
 * Demande une confirmation à deux temps. `carte` (facultatif) remplace le
 * corps texte par une carte dessinée (utils/actionCard.js) : même monde
 * visuel que les cartes de sanction. Le repli sur le texte est délibéré — une
 * confirmation qui ne s'affiche pas rendrait l'action impossible à lancer.
 */
function requestConfirmation(message, { title, body, confirmLabel, permission, execute, carte }) {
  const token = rememberConfirm({ actorId: message.author.id, permission, execute });
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ID}:confirm:go:${token}`).setLabel(confirmLabel).setStyle(ButtonStyle.Danger).setEmoji(EMOJI.CHECK),
    new ButtonBuilder().setCustomId(`${ID}:confirm:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.CROSS)
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
  if (!pending) return interaction.update(card("Expiré", "Relance la commande pour recommencer."));
  if (interaction.user.id !== pending.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }
  pendingConfirms.delete(token);

  if (action === "no") return interaction.update(card("Annulé", null));

  if (!can(interaction.member, pending.permission)) {
    return interaction.update(card("Accès refusé", "Tu n'as plus ce droit."));
  }
  await pending.execute(interaction);
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
        couleur: "#ff6b6b",
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
      execute: async (interaction) => {
        const fresh = interaction.guild.roles.cache.get(roleId);
        if (!fresh) return interaction.update(card("Rôle introuvable", "Ce rôle n'existe déjà plus."));
        try {
          await fresh.delete(`Rôle supprimé par ${interaction.user.tag}`);
        } catch (err) {
          return interaction.update(card("Action impossible", `Discord a refusé : ${err.message}`));
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
        return interaction.update(card("Terminé", `Rôle **${name}** supprimé.`));
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
      execute: async (interaction) => {
        const fresh = interaction.guild.roles.cache.get(roleId);
        if (!fresh) return interaction.update(card("Rôle introuvable", "Ce rôle n'existe plus."));
        try {
          const next = grant ? fresh.permissions.add(PermissionFlagsBits.Administrator) : fresh.permissions.remove(PermissionFlagsBits.Administrator);
          await fresh.setPermissions(next, `${grant ? "Administrateur donné" : "Administrateur retiré"} par ${interaction.user.tag}`);
        } catch (err) {
          return interaction.update(card("Action impossible", `Discord a refusé : ${err.message}`));
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
        return interaction.update(card("Terminé", `Administrateur ${grant ? "donné à" : "retiré de"} **${name}**.`));
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
      execute: async (interaction) => {
        const fresh = interaction.guild.channels.cache.get(id);
        if (!fresh) return interaction.update(card("Salon introuvable", "Ce salon n'existe déjà plus."));
        try {
          await fresh.delete(`Salon supprimé par ${interaction.user.tag}`);
        } catch (err) {
          return interaction.update(card("Action impossible", `Discord a refusé : ${err.message}`));
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
        return interaction.update(card("Terminé", `Salon **${name}** supprimé.`)).catch(() => {});
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
        { title: "Dero automatique" }
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

// --- &antinuke : statut, marche/arrêt, sanction, whitelist par rôle (la
// whitelist par utilisateur vit dans &panel > Anti-nuke, un UserSelectMenu
// suffit là où un rôle a besoin d'un RoleSelectMenu à part). ---

async function antinuke(client, message, args) {
  if (!can(message.member, "protection.guard.manage")) return;
  const sub = (args[0] || "").toLowerCase();
  const guildId = message.guild.id;

  if (sub === "on" || sub === "off") {
    guardConfig.setEnabled(guildId, sub === "on");
    return reply(message, "success", `Anti-nuke ${sub === "on" ? "activé" : "désactivé"}.`);
  }

  if (sub === "punishment") {
    const value = (args[1] || "").toLowerCase();
    if (!guardConfig.setPunishment(guildId, value)) {
      return reply(message, "error", "Sanction invalide. Utilise : `timeout`, `kick` ou `ban`.");
    }
    return reply(message, "success", `Sanction de l'anti-nuke réglée sur **${value}**.`);
  }

  if (sub === "wlrole") {
    const role = message.mentions.roles?.first();
    if (!role) return reply(message, "error", "Indique un rôle : `antinuke wlrole @rôle`.");
    const removed = guardWhitelist.remove(guildId, "roles", role.id);
    if (!removed) guardWhitelist.add(guildId, "roles", role.id);
    return reply(
      message,
      "success",
      removed ? `**${role.name}** retiré de la whitelist anti-nuke.` : `**${role.name}** ajouté à la whitelist anti-nuke.`
    );
  }

  if (sub === "wluser") {
    const mentioned = message.mentions.users?.first();
    const rawId = (args[1] || "").replace(/\D/g, "");
    const userId = mentioned?.id || (rawId.length >= 15 ? rawId : null);
    if (!userId) return reply(message, "error", "Indique un membre (mention ou ID) : `antinuke wluser @membre`.");
    const removed = guardWhitelist.remove(guildId, "users", userId);
    if (!removed) guardWhitelist.add(guildId, "users", userId);
    return reply(
      message,
      "success",
      removed ? `<@${userId}> retiré de la whitelist anti-nuke.` : `<@${userId}> ajouté à la whitelist anti-nuke.`
    );
  }

  if (sub === "clearwl") {
    const count = guardWhitelist.clearAll(guildId);
    return reply(
      message,
      "success",
      count ? `Whitelist anti-nuke vidée (${count} entrée(s) retirée(s)).` : "La whitelist anti-nuke était déjà vide."
    );
  }

  if (sub === "ping") {
    if ((args[1] || "").toLowerCase() === "off") {
      guardConfig.setPingRole(guildId, null);
      return reply(message, "success", "Ping anti-nuke désactivé.");
    }
    const role = message.mentions.roles?.first();
    if (!role) return reply(message, "error", "Indique un rôle ou `off` : `antinuke ping @rôle` ou `antinuke ping off`.");
    guardConfig.setPingRole(guildId, role.id);
    return reply(message, "success", `**${role.name}** sera pingé à chaque déclenchement de l'anti-nuke.`);
  }

  if (sub === "autolockdown") {
    const value = (args[1] || "").toLowerCase();
    if (value !== "on" && value !== "off") {
      return reply(message, "error", "Utilise : `antinuke autolockdown on` ou `antinuke autolockdown off`.");
    }
    guardConfig.setAutoLockdown(guildId, value === "on");
    return reply(
      message,
      "success",
      value === "on"
        ? "Verrouillage automatique activé : le serveur entier se verrouillera si l'anti-nuke atteint son plafond de sanctions."
        : "Verrouillage automatique désactivé."
    );
  }

  if (sub === "creationlimit") {
    if ((args[1] || "").toLowerCase() === "off") {
      guardConfig.setCreationLimit(guildId, 0);
      return reply(message, "success", "Seuil de création de compte désactivé.");
    }
    const ms = parseDuration(args[1]);
    if (!ms) return reply(message, "error", "Indique une durée ou `off` : `antinuke creationlimit 7d` ou `antinuke creationlimit off`.");
    guardConfig.setCreationLimit(guildId, ms);
    return reply(message, "success", `Les comptes créés il y a moins de **${args[1]}** seront sanctionnés à l'arrivée.`);
  }

  const config = guardConfig.getConfig(guildId);
  await message.reply({
    embeds: [
      buildStatusEmbed(
        "info",
        [
          `> **Statut** : ${config.enabled ? "activé" : "désactivé"}`,
          `> **Sanction** : ${config.punishment}`,
          `> **Ping** : ${config.pingRoleId ? `<@&${config.pingRoleId}>` : "*aucun*"}`,
          `> **Seuil de création de compte** : ${config.creationLimitMs ? `${Math.round(config.creationLimitMs / 86400000)}j` : "*désactivé*"}`,
          "",
          "`antinuke on|off` — activer/désactiver",
          "`antinuke punishment timeout|kick|ban` — changer la sanction",
          "`antinuke wlrole @rôle` / `wluser @membre` — exempter/retirer un rôle ou un membre",
          "`antinuke clearwl` — vider toute la whitelist",
          "`antinuke ping @rôle|off` — pingé en plus du log à chaque déclenchement",
          "`antinuke creationlimit <durée>|off` — sanctionne les comptes trop récents à l'arrivée",
          "",
          "Liste des guards et leurs seuils : `&panel` > Anti-nuke.",
        ].join("\n"),
        { title: "Anti-nuke" }
      ),
    ],
  });
}

// --- Salons vocaux temporaires (&voicehub, &voc) ---

async function voicehub(client, message, args) {
  if (!can(message.member, "server.voice.manage")) return;
  const channel = message.mentions.channels?.first();
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    if ((args[0] || "").toLowerCase() === "off") {
      voiceChannels.setHub(message.guild.id, null);
      return reply(message, "success", "Salon générateur désactivé.");
    }
    return reply(message, "error", "Indique un salon vocal : `voicehub #salon-vocal`, ou `voicehub off`.");
  }
  voiceChannels.setHub(message.guild.id, channel.id);
  return reply(message, "success", `Rejoindre <#${channel.id}> crée désormais un salon vocal personnel.`);
}

/**
 * Vrai si `member` est le propriétaire ACTUEL du salon temporaire —
 * strictement, sans exception pour owner/sys (demande explicite : le rang
 * owner/sys passait outre et pouvait gérer n'importe quel salon temporaire
 * sans en être le créateur, via le panneau ET &voc — plus de bypass du tout).
 */
function canManageVoiceChannel(member, channel) {
  const info = voiceChannels.getChannelInfo(channel.id);
  return info?.ownerId === member.id;
}

/**
 * Le salon-panneau partagé n'est visible QUE par qui possède actuellement
 * un salon vocal temporaire actif — demande explicite : "seul la personne
 * qui a créé et accès à la voc peut avoir accès au panel control". Appelé à
 * la création d'un salon temporaire, à sa suppression, et à un transfert de
 * propriété (voir index.js et handleVoiceControlInteraction, action
 * "transferpick"/&voc transfer).
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {boolean} allowed
 */
async function setPanelAccess(guild, userId, allowed) {
  const panelChannelId = voiceChannels.getHubConfig(guild.id).panelChannelId;
  const panelChannel = panelChannelId && guild.channels.cache.get(panelChannelId);
  if (!panelChannel) return;
  // Corrige au passage un salon-panneau créé avant cette restriction
  // (@everyone pouvait encore le voir) — idempotent, sans risque à rejouer.
  await panelChannel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }).catch(() => {});
  if (allowed) {
    await panelChannel.permissionOverwrites.edit(userId, { ViewChannel: true }, { reason: "Salon vocal temporaire actif" }).catch(() => {});
  } else {
    await panelChannel.permissionOverwrites.delete(userId, "Salon vocal temporaire terminé ou transféré").catch(() => {});
  }
}

/**
 * "&h" — rappel compact des commandes `&voc` (mêmes sous-commandes que
 * `vc()` juste en dessous, jamais dupliquées), demande explicite ("un help
 * voc perso... uniquement visible dans la vocale créée temporairement" —
 * inspiré d'une capture d'un autre bot). Ouvert à tout le monde dans le
 * salon (pas réservé au propriétaire, contrairement à `vc()` : c'est de la
 * lecture, comme &help) — mais ne répond QUE depuis un vrai salon vocal
 * temporaire, jamais ailleurs.
 */
async function voiceHelp(client, message) {
  const channel = message.member.voice.channel;
  if (!channel || !voiceChannels.getChannelInfo(channel.id)) {
    return reply(message, "error", "Cette aide n'est disponible que depuis TON salon vocal temporaire.");
  }

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🔊 Salon vocal temporaire"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "**Accès**",
        "`&voc unlock` / `&voc lock` — Ouvrir ou verrouiller",
        "`&voc add @membre` / `&voc remove @membre` — Autoriser / retirer",
        "`&voc kick @membre` — Déconnecter du salon",
        "",
        "**Salon**",
        "`&voc rename <nom>` — Renommer",
        "`&voc limit <n>` — Limiter les places (0 = illimité)",
        "`&voc transfer @membre` — Céder la propriété",
      ].join("\n")
    )
  );

  return message.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });
}

async function vc(client, message, args) {
  const channel = message.member.voice.channel;
  if (!channel) return reply(message, "error", "Tu dois être dans un salon vocal temporaire.");
  const info = voiceChannels.getChannelInfo(channel.id);
  if (!info) return reply(message, "error", "Ce salon vocal n'est pas un salon temporaire géré par le bot.");
  if (!canManageVoiceChannel(message.member, channel)) {
    return reply(message, "error", "Seul le propriétaire de ce salon peut le gérer.");
  }

  const sub = (args[0] || "").toLowerCase();
  const everyone = message.guild.roles.everyone;

  if (sub === "lock" || sub === "unlock") {
    await channel.permissionOverwrites
      .edit(everyone, { Connect: sub === "lock" ? false : null }, { reason: `Salon vocal ${sub === "lock" ? "verrouillé" : "déverrouillé"} par ${message.author.tag}` })
      .catch(() => {});
    return reply(message, "success", sub === "lock" ? "Salon verrouillé." : "Salon déverrouillé.");
  }

  if (sub === "limit") {
    const n = parseInt(args[1], 10);
    if (isNaN(n) || n < 0 || n > 99) return reply(message, "error", "Indique une limite entre 0 (illimité) et 99 : `voc limit <n>`.");
    await channel.setUserLimit(n, `Limite changée par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", n === 0 ? "Limite retirée." : `Limite réglée sur **${n}**.`);
  }

  if (sub === "rename") {
    const name = args.slice(1).join(" ").trim();
    if (!name) return reply(message, "error", "Indique un nom : `voc rename <nom>`.");
    await channel.setName(name, `Renommé par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", `Salon renommé **${name}**.`);
  }

  if (sub === "kick") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc kick @membre`.");
    if (target.voice.channelId !== channel.id) return reply(message, "error", "Ce membre n'est pas dans ton salon.");
    await target.voice.disconnect(`Expulsé du salon vocal par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", `**${target.user.tag}** expulsé du salon.`);
  }

  if (sub === "add") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc add @membre`.");
    await channel.permissionOverwrites
      .edit(target, { ViewChannel: true, Connect: true }, { reason: `Accès accordé par ${message.author.tag}` })
      .catch(() => {});
    return reply(message, "success", `**${target.user.tag}** peut désormais rejoindre ce salon, même verrouillé.`);
  }

  if (sub === "remove") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc remove @membre`.");
    await channel.permissionOverwrites.delete(target, `Accès retiré par ${message.author.tag}`).catch(() => {});
    if (target.voice.channelId === channel.id) await target.voice.disconnect(`Accès retiré par ${message.author.tag}`).catch(() => {});
    return reply(message, "success", `Accès de **${target.user.tag}** retiré.`);
  }

  if (sub === "transfer") {
    const target = message.mentions.members?.first();
    if (!target) return reply(message, "error", "Indique un membre : `voc transfer @membre`.");
    if (target.voice.channelId !== channel.id) return reply(message, "error", "Ce membre doit être dans ton salon pour en devenir propriétaire.");
    const previousOwnerId = voiceChannels.getChannelInfo(channel.id)?.ownerId;
    voiceChannels.registerChannel(channel.id, message.guild.id, target.id);
    if (previousOwnerId) await setPanelAccess(message.guild, previousOwnerId, false);
    await setPanelAccess(message.guild, target.id, true);
    return reply(message, "success", `**${target.user.tag}** est désormais propriétaire de ce salon.`);
  }

  return reply(message, "error", "Utilise `voc lock|unlock|limit <n>|rename <nom>|kick @membre|add @membre|remove @membre|transfer @membre`.");
}

// --- Panneau de contrôle PARTAGÉ, un seul salon texte permanent créé par
// &panel > Communauté > Vocaux > "Créer la configuration" (voir
// utils/voiceHubSetup.js) — plus un salon compagnon par salon vocal créé
// puis détruit à chaque fois. Les boutons agissent sur le salon vocal où la
// personne qui clique est CONNECTÉE au moment du clic, exactement comme un
// panneau "Voice Create" classique : mêmes vérifications que la commande
// texte (canManageVoiceChannel), rien de plus permissif.

/** Les mêmes boutons, réutilisés par le panneau partagé ET l'accueil du salon (voir plus bas). */
function voiceControlButtonRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vcpanel:lock").setLabel("Fermer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:unlock").setLabel("Ouvrir").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:add").setLabel("Ajouter").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:remove").setLabel("Retirer").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("vcpanel:rename").setLabel("Renommer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:transfer").setLabel("Transférer").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("vcpanel:kick").setLabel("Expulser").setStyle(ButtonStyle.Danger)
    ),
  ];
}

/** Panneau de contrôle STATIQUE, posté une seule fois dans le salon-panneau partagé. */
function buildVoiceControlCard() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎛️ Centre de contrôle vocal"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Un seul panneau pour tout le monde : les boutons agissent toujours sur **ton** salon vocal temporaire, " +
        "celui où tu es connecté au moment du clic — peu importe d'où tu cliques.\n" +
        "Toujours accessible en texte, où que tu sois : `&voc lock|unlock|limit <n>|rename <nom>|kick|add|remove|transfer @membre`."
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(...voiceControlButtonRows());
  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { parse: [] } };
}

/**
 * Message posté dans le chat du salon VOCAL lui-même à sa création : il
 * mentionne le propriétaire (d'où allowedMentions, sans quoi le client
 * Discord.js n'envoie aucune notification — voir index.js) avec un seul
 * bouton "Gérer ton salon" qui emmène directement au salon-panneau partagé
 * (accès garanti : setPanelAccess donne la vue à cette personne dès la
 * création de son salon).
 *
 * CHOIX ASSUMÉ malgré un bug confirmé : un bouton-lien cliqué depuis le
 * chat propre à un salon vocal ne navigue pas de façon fiable sur mobile
 * (la personne reste bloquée sur le message) — comportement du client
 * Discord, hors de portée du bot. Un repli existait (contrôles ouverts en
 * éphémère, sans navigation) mais a été explicitement refusé : demande de
 * garder le lien malgré tout, quitte à ce qu'il ne marche pas partout.
 * Repli conservé UNIQUEMENT si aucun salon-panneau n'est configuré (aucun
 * lien possible dans ce cas).
 */
function buildVoiceWelcomeCard(channel, ownerId, panelChannelId) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔊 <@${ownerId}>, ton salon est prêt`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const bouton = panelChannelId
    ? new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Gérer ton salon")
        .setURL(`https://discord.com/channels/${channel.guildId}/${panelChannelId}`)
    : new ButtonBuilder().setCustomId("vcpanel:menu").setLabel("Gérer ton salon").setStyle(ButtonStyle.Primary);
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(bouton)
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { users: [ownerId] } };
}

async function handleVoiceControlInteraction(interaction) {
  const [, action] = interaction.customId.split(":");

  // Le panneau est PARTAGÉ (un seul salon pour tout le monde) : le salon
  // ciblé est celui où la personne qui clique est connectée EN VOCAL à cet
  // instant, pas celui où elle a cliqué. Doit être un salon TEMPORAIRE
  // réellement enregistré (voiceChannels.getChannelInfo), sinon même le
  // générateur lui-même serait manipulable. Même garde-fou que la commande
  // texte &voc (ci-dessus).
  const voiceChannelId = interaction.member?.voice?.channelId;
  const channel = voiceChannelId ? interaction.guild.channels.cache.get(voiceChannelId) : null;
  const isTempChannel = channel?.type === ChannelType.GuildVoice && voiceChannels.getChannelInfo(channel.id);
  if (!isTempChannel) {
    return interaction.reply({
      content: "Rejoins d'abord TON salon vocal temporaire (créé en rejoignant le générateur), puis reclique.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!canManageVoiceChannel(interaction.member, channel)) {
    return interaction.reply({ content: "Seul le propriétaire de ce salon peut le gérer.", flags: MessageFlags.Ephemeral });
  }

  // Bouton "Gérer ton salon" de l'accueil du vocal (voir buildVoiceWelcomeCard).
  if (action === "menu") {
    const menu = new ContainerBuilder();
    menu.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎛️ ${channel.name}`));
    menu.addActionRowComponents(...voiceControlButtonRows());
    return interaction.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [menu] });
  }

  if (action === "lock" || action === "unlock") {
    await channel.permissionOverwrites
      .edit(interaction.guild.roles.everyone, { Connect: action === "lock" ? false : null }, { reason: `Salon vocal ${action === "lock" ? "verrouillé" : "déverrouillé"} par ${interaction.user.tag}` })
      .catch(() => {});
    return interaction.reply({ content: action === "lock" ? "Salon verrouillé." : "Salon déverrouillé.", flags: MessageFlags.Ephemeral });
  }

  if (action === "rename") {
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rien n'a changé.", flags: MessageFlags.Ephemeral });
      await channel.setName(name, `Renommé par ${interaction.user.tag}`).catch(() => {});
      return interaction.reply({ content: `Salon renommé **${name}**.`, flags: MessageFlags.Ephemeral });
    }
    const modal = new ModalBuilder().setCustomId("vcpanel:rename").setTitle("Renommer le salon");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (["add", "remove", "transfer", "kick"].includes(action)) {
    return interaction.reply({
      content: `Choisis un membre pour "${{ add: "Ajouter", remove: "Retirer", transfer: "Transférer la propriété", kick: "Expulser" }[action]}".`,
      components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`vcpanel:${action}pick`).setPlaceholder("Choisir un membre"))],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (["addpick", "removepick", "transferpick", "kickpick"].includes(action)) {
    const target = await interaction.guild.members.fetch(interaction.values[0]).catch(() => null);
    if (!target) return interaction.reply({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });

    if (action === "addpick") {
      await channel.permissionOverwrites.edit(target, { ViewChannel: true, Connect: true }, { reason: `Accès accordé par ${interaction.user.tag}` }).catch(() => {});
      return interaction.update({ content: `**${target.user.tag}** peut désormais rejoindre ce salon, même verrouillé.`, components: [] });
    }
    if (action === "removepick") {
      await channel.permissionOverwrites.delete(target, `Accès retiré par ${interaction.user.tag}`).catch(() => {});
      if (target.voice.channelId === channel.id) await target.voice.disconnect(`Accès retiré par ${interaction.user.tag}`).catch(() => {});
      return interaction.update({ content: `Accès de **${target.user.tag}** retiré.`, components: [] });
    }
    if (action === "transferpick") {
      if (target.voice.channelId !== channel.id) {
        return interaction.update({ content: "Ce membre doit être dans le salon pour en devenir propriétaire.", components: [] });
      }
      const previousOwnerId = voiceChannels.getChannelInfo(channel.id)?.ownerId;
      voiceChannels.registerChannel(channel.id, interaction.guild.id, target.id);
      if (previousOwnerId) await setPanelAccess(interaction.guild, previousOwnerId, false);
      await setPanelAccess(interaction.guild, target.id, true);
      return interaction.update({ content: `**${target.user.tag}** est désormais propriétaire de ce salon.`, components: [] });
    }
    if (action === "kickpick") {
      if (target.voice.channelId !== channel.id) return interaction.update({ content: "Ce membre n'est pas dans le salon.", components: [] });
      await target.voice.disconnect(`Expulsé du salon vocal par ${interaction.user.tag}`).catch(() => {});
      return interaction.update({ content: `**${target.user.tag}** expulsé du salon.`, components: [] });
    }
  }
}

module.exports = {
  owners,
  access,
  handleAccessGrantTextCommand,
  antinuke,
  whitelist,
  allbots,
  handleServerAdminInteraction,
  roleAdmin,
  limitRole,
  channelAdmin,
  dero,
  applyDeroToNewChannel,
  voicehub,
  vc,
  voiceHelp,
  buildVoiceControlCard,
  buildVoiceWelcomeCard,
  handleVoiceControlInteraction,
  setPanelAccess,
  handleConfirmInteraction,
  requestConfirmation,
  ROLE_ADMIN_SUBCOMMANDS,
  CHANNEL_ADMIN_SUBCOMMANDS,
  ID,
};
