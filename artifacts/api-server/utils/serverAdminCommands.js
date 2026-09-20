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
const { can } = require("./permissions/engine");
const permStore = require("./permissions/store");
const permCatalog = require("./permissions/catalog");
const voiceAccess = require("./voiceAccess");
const accessStore = require("./accessStore");
const automod = require("./automod/antiSpam");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const deroStore = require("./deroStore");
const { checkBotPermission, report } = require("./moderation/actions");
const { parseDuration } = require("./moderationCommands");
const roleLimitStore = require("./roleLimitStore");
const { getPrefixes } = require("./prefixStore");
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
 * Carte de "=add"/"!!owner" — présentation demandée explicitement
 * (titre "Owner", "Utilisateur"/"Statut"/"Consulté par" en évidence, liste
 * numérotée des accès, coche/croix verte-rouge par clé dans le menu ouvert,
 * comme la capture d'un autre bot). `derniereCle` fait porter la coche
 * bleue native de Discord (option sélectionnée par défaut) sur la clé qui
 * vient d'être basculée — l'équivalent exact du "pvclear" mis en évidence
 * sur la capture, sans rien dessiner nous-mêmes. `categoriesAutorisees`
 * (tableau de clés de catégorie, ex. ["moderation","channels"]) restreint le
 * résumé ET le sélecteur de catégories à CES catégories du VRAI catalogue —
 * c'est ce qui distingue "=add" (tout le catalogue vocal),
 * "&owner" (legacy modération : moderation/channels/members/logs) et
 * "!!owner" (sécurité : protection)
 * sans dupliquer la moindre logique de rendu. Même mécanisme de fond que
 * buildAccessCard (mêmes permStore/permCatalog, catégorie -> clé) : "Statut"
 * reflète l'état RÉEL d'accès individuel de ce membre — jamais le mot
 * "Owner" tel quel, qui désignerait à tort le VRAI rang propriétaire du bot
 * (utils/accessStore.js), refusé plus haut avant l'appel. Les 9 libellés de
 * la capture qui a inspiré cette carte (wakeup, dog, pvlist...) n'existent
 * pas sur ce bot : le VRAI catalogue de permissions sert de base, jamais un
 * accès inventé — demande explicite.
 */
function buildOwnerAccessCard(
  guildId,
  memberId,
  memberTag,
  consultePar,
  category = null,
  derniereCle = null,
  categoriesAutorisees = null,
  variante = "owner"
) {
  const granted = permStore.getUserGrants(guildId, memberId);
  const groupes = categoriesAutorisees
    ? permCatalog.byCategory().filter((g) => categoriesAutorisees.includes(g.category))
    : permCatalog.byCategory();
  const clesAutorisees = groupes.flatMap((g) => g.permissions.map((p) => p.key));
  const grantedFiltre = categoriesAutorisees ? granted.filter((key) => clesAutorisees.includes(key)) : granted;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Owner"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Utilisateur** — <@${memberId}>`,
        `**Statut** — ${grantedFiltre.length ? iconDe(guildId, "CHECK") : iconDe(guildId, "CROSS")} ${grantedFiltre.length ? "Accès individuel actif" : "Aucun accès individuel"}`,
        `**Consulté par** — ${consultePar}`,
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Accès attribués — ${grantedFiltre.length}**`,
        "",
        grantedFiltre.length
          ? grantedFiltre.map((key, i) => `\`${String(i + 1).padStart(2, "0")}\` — ${permCatalog.label(key)}`).join("\n")
          : "*Aucun accès individuel pour l'instant.*",
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`srv:${variante}cat:${memberId}`)
        .setPlaceholder("Choisir une catégorie")
        .addOptions(
          groupes.map((g) => new StringSelectMenuOptionBuilder().setLabel(g.label).setValue(g.category).setDefault(g.category === category))
        )
    )
  );

  const groupeOuvert = category && groupes.find((g) => g.category === category);
  if (groupeOuvert) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`srv:${variante}key:${memberId}:${category}`)
          .setPlaceholder(`Ajouter ou retirer un accès — ${groupeOuvert.label}`)
          .addOptions(
            groupeOuvert.permissions.slice(0, 25).map((p) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(p.label.slice(0, 100))
                .setValue(p.key)
                .setEmoji(granted.includes(p.key) ? iconDe(guildId, "CHECK") : iconDe(guildId, "CROSS"))
                .setDescription(granted.includes(p.key) ? "Actuellement accordée" : "Actuellement non accordée")
                .setDefault(p.key === derniereCle)
            )
          )
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Carte "Owner" VOCALE de "=add" (préfixe vocal "=") — liste PLATE des vraies
 * commandes vocales à cocher (✓ accordée / ✗ refusée), comme la capture
 * "Ajouter ou retirer un accès" : PAS de sélecteur de catégorie
 * (Modération/Salons/…), directement les accès vocaux. Chaque coche donne
 * VRAIMENT le droit d'utiliser la commande (permStore "voice.<cmd>", vérifié
 * par voiceAccess.peutVocal). `derniereCle` porte la coche bleue native de
 * Discord sur l'accès qui vient d'être basculé.
 */
function buildVoiceOwnerCard(guildId, memberId, consultePar, derniereCle = null) {
  const granted = permStore.getUserGrants(guildId, memberId).filter((k) => voiceAccess.VOICE_ACCESS_KEYS.includes(k));

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Owner"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Utilisateur** — <@${memberId}>`,
        `**Statut** — ${granted.length ? iconDe(guildId, "CHECK") : iconDe(guildId, "CROSS")} ${granted.length ? "Accès vocaux actifs" : "Aucun accès vocal"}`,
        `**Attribué par** — ${consultePar}`,
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
          ? granted.map((key, i) => `\`${String(i + 1).padStart(2, "0")}\` — ${voiceAccess.LABEL_PAR_CLE[key]}`).join("\n")
          : "*Aucun accès vocal pour l'instant.*",
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`srv:voiceowner:${memberId}`)
        .setPlaceholder("Ajouter ou retirer un accès")
        .addOptions(
          voiceAccess.VOICE_ACCESS.map((a) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(a.label)
              .setValue(a.key)
              .setEmoji(granted.includes(a.key) ? iconDe(guildId, "CHECK") : iconDe(guildId, "CROSS"))
              .setDescription(a.description.slice(0, 100))
              .setDefault(a.key === derniereCle)
          )
        )
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * &access <@membre|id> — ouvre le panneau d'octroi de permissions
 * individuelles pour CE membre. `label` ne sert qu'au message d'erreur :
 * "=add"/"&owner"/"!!owner" (préfixes séparés, voir les handlers
 * dédiés ci-dessous) délèguent ici mais doivent rappeler LEUR propre
 * syntaxe ; `ownerStyle` fait poster la carte "Owner" (buildOwnerAccessCard)
 * au lieu de la carte générique — même mécanisme de fond, présentation
 * différente ; `categoriesAutorisees`, transmis tel quel à
 * buildOwnerAccessCard, restreint quelles catégories du catalogue "&owner"/
 * "!!owner" peuvent voir et modifier (jamais utilisé par "&access"/"=add",
 * qui gardent le catalogue complet).
 */
async function access(client, message, args, label = "access", ownerStyle = false, categoriesAutorisees = null, variante = "owner") {
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
    return message.reply(
      buildOwnerAccessCard(message.guild.id, target.id, target.user.tag, message.author.tag, null, null, categoriesAutorisees, variante)
    );
  }
  await message.reply(buildAccessCard(message.guild.id, target.id, target.user.tag));
}

/**
 * "=add <@membre|id>" ouvre la carte "Owner" VOCALE
 * (buildVoiceOwnerCard), liste plate des commandes vocales à cocher. Cocher
 * une commande donne vraiment le droit de l'utiliser (voiceAccess). Gardé
 * sous le droit `panel.permissions.manage` (qui peut OUVRIR la carte).
 *
 * "=owner <@membre|id>" est l'action rapide du même préfixe : elle bascule
 * l'accès à TOUTES les clés de voiceAccess.VOICE_ACCESS_KEYS en une fois.
 * Cette bascule ne touche qu'aux permissions individuelles du préfixe "=" ;
 * elle ne distribue ni ne modifie le rang propriétaire du bot ou le rang sys.
 * Le catalogue générique reste dispo via "&access"/"&owner"/"!!owner".
 */
async function handleAddAccessTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const { owner: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
  const mot = (cmd || "").toLowerCase();
  if (mot !== "add" && mot !== "owner") return; // mot inconnu sur ce préfixe : silence

  if (!can(message.member, "panel.permissions.manage")) return;

  const mentionMatch = args[0]?.match(/^<@!?(\d{15,25})>$/);
  const idMatch = args[0]?.match(/^\d{15,25}$/);
  const targetId = mentionMatch?.[1] || idMatch?.[0];
  if (!targetId) return reply(message, "error", `Indique un membre (mention ou identifiant) : \`${mot} @membre\`.`);

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) return reply(message, "error", "Ce membre n'est pas sur le serveur.");

  if (accessStore.isOwner(target.id) || accessStore.isSys(target.id)) {
    return reply(message, "info", `${target.user.tag} est déjà propriétaire/rang sys — accès complet, rien à accorder en plus.`);
  }

  if (mot === "owner") {
    const granted = permStore.getUserGrants(message.guild.id, target.id);
    const hasEveryVoiceKey = voiceAccess.VOICE_ACCESS_KEYS.every((key) => granted.includes(key));

    if (hasEveryVoiceKey) {
      for (const key of voiceAccess.VOICE_ACCESS_KEYS) {
        permStore.revokeFromUser(message.guild.id, target.id, key);
      }
      return reply(
        message,
        "success",
        `${target.user.tag} — l'accès complet au préfixe "=" a été retiré (toutes les commandes vocales).`
      );
    }

    for (const key of voiceAccess.VOICE_ACCESS_KEYS) {
      if (!granted.includes(key)) permStore.grantToUser(message.guild.id, target.id, key);
    }
    return reply(
      message,
      "success",
      `${target.user.tag} a maintenant accès à l'intégralité du préfixe "=" (toutes les commandes vocales).`
    );
  }

  return message.reply(buildVoiceOwnerCard(message.guild.id, target.id, message.author.tag));
}

const CATEGORIES_OWNER_MODERATION = ["moderation", "channels", "members", "logs"];
const CATEGORIES_OWNER_SECURITE = ["protection"];

/**
 * Legacy helper "&owner <@membre|id>" — carte "Owner" filtrée aux catégories
 * de MODÉRATION du VRAI catalogue (moderation/channels/members/logs) : jamais
 * les permissions sécurité/serveur/panel qui n'ont rien à faire ici.
 * La commande publique `&owner` reste réservée par le routeur à la famille
 * gestion ; ce helper reste exporté pour les anciennes interactions internes
 * et la compatibilité du catalogue de permissions. L'action rapide `=owner`
 * est gérée séparément par handleAddAccessTextCommand.
 */
async function ownerModeration(client, message, args) {
  return access(client, message, args, "owner", true, CATEGORIES_OWNER_MODERATION, "modowner");
}

/**
 * "!!owner <@membre|id>" — carte "Owner" filtrée à la catégorie SÉCURITÉ du
 * VRAI catalogue (protection.*) : jamais les permissions de modération/
 * salons/serveur qui n'ont rien à faire ici.
 */
async function handleSecurityOwnerTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "owner") return; // mot inconnu sur ce préfixe : silence

  return access(client, message, args, "owner", true, CATEGORIES_OWNER_SECURITE, "secowner");
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

  // Panneau "Owner" (voir buildOwnerAccessCard) — 3 variantes du MÊME
  // mécanisme sur 3 paires de customId distinctes, chacune avec son propre
  // filtre de catégories réelles : "ownercat"/"ownerkey" = "=add" (catalogue
  // complet), "modownercat"/"modownerkey" = legacy "&owner" (modération),
  // "secownercat"/"secownerkey" = "!!owner" (sécurité). Les 3 doivent garder
  // LEUR filtre au clic suivant, d'où la variante encodée dans le customId
  // lui-même plutôt que dans un état à part. "Consulté par" reflète TOUJOURS
  // qui clique maintenant, pas qui a tapé la commande au départ — aucun état
  // à porter dans le customId pour ça.
  const VARIANTES_OWNER = {
    ownercat: { variante: "owner", categories: null },
    ownerkey: { variante: "owner", categories: null },
    modownercat: { variante: "modowner", categories: CATEGORIES_OWNER_MODERATION },
    modownerkey: { variante: "modowner", categories: CATEGORIES_OWNER_MODERATION },
    secownercat: { variante: "secowner", categories: CATEGORIES_OWNER_SECURITE },
    secownerkey: { variante: "secowner", categories: CATEGORIES_OWNER_SECURITE },
  };
  if (VARIANTES_OWNER[action]) {
    if (!can(interaction.member, "panel.permissions.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const { variante, categories } = VARIANTES_OWNER[action];
    const memberId = idKind;
    const target = await interaction.guild.members.fetch(memberId).catch(() => null);
    const tag = target?.user?.tag || `<@${memberId}>`;

    if (action.endsWith("cat")) {
      return interaction.update(
        buildOwnerAccessCard(interaction.guild.id, memberId, tag, interaction.user.tag, interaction.values[0], null, categories, variante)
      );
    }

    const category = extra;
    const key = interaction.values[0];
    const granted = permStore.getUserGrants(interaction.guild.id, memberId);
    if (granted.includes(key)) permStore.revokeFromUser(interaction.guild.id, memberId, key);
    else permStore.grantToUser(interaction.guild.id, memberId, key);
    return interaction.update(
      buildOwnerAccessCard(interaction.guild.id, memberId, tag, interaction.user.tag, category, key, categories, variante)
    );
  }

  // Carte "Owner" VOCALE de "=add" — liste plate d'accès vocaux
  // (voir buildVoiceOwnerCard). Un seul sélecteur, pas d'étape catégorie.
  if (action === "voiceowner") {
    if (!can(interaction.member, "panel.permissions.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const memberId = idKind;
    const key = interaction.values[0];
    if (!voiceAccess.VOICE_ACCESS_KEYS.includes(key)) return interaction.deferUpdate().catch(() => {});
    const granted = permStore.getUserGrants(interaction.guild.id, memberId);
    if (granted.includes(key)) permStore.revokeFromUser(interaction.guild.id, memberId, key);
    else permStore.grantToUser(interaction.guild.id, memberId, key);
    return interaction.update(buildVoiceOwnerCard(interaction.guild.id, memberId, interaction.user.tag, key));
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
      return reply(message, "success", "Anti-Fast désactivé (seuil de création de compte retiré).");
    }
    const ms = parseDuration(args[1]);
    if (!ms) return reply(message, "error", "Indique une durée ou `off` : `antinuke creationlimit 7d` ou `antinuke creationlimit off`.");
    guardConfig.setCreationLimit(guildId, ms);
    return reply(message, "success", `Anti-Fast : les comptes créés il y a moins de **${args[1]}** seront expulsés à l'arrivée.`);
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
          `> **Anti-Fast (âge minimum)** : ${config.antiFastEnabled && config.antiFastMinAgeDays ? `${config.antiFastMinAgeDays}j` : "*désactivé*"}`,
          "",
          "`antinuke on|off` — activer/désactiver",
          "`antinuke punishment timeout|kick|ban` — changer la sanction",
          "`antinuke wlrole @rôle` / `wluser @membre` — exempter/retirer un rôle ou un membre",
          "`antinuke clearwl` — vider toute la whitelist",
          "`antinuke ping @rôle|off` — pingé en plus du log à chaque déclenchement",
          "`antinuke creationlimit <durée>|off` — alias historique pour configurer Anti-Fast (expulsion des comptes trop récents)",
          "",
          "Liste des guards et leurs seuils : `&panel` > Anti-nuke.",
        ].join("\n"),
        { title: "Anti-nuke", guildId }
      ),
    ],
  });
}

// --- Écosystème VOCAL sur "=" (architecture 4 préfixes : & = gestion,
// !! = sécurité, = = vocal) — voir index.js pour le dispatch du préfixe.
// Un simple catalogue de commandes vocales RÉELLES, chacune une action de
// modération vocale ponctuelle sur N'IMPORTE QUEL membre en vocal — PAS un
// nouveau système de propriété/salons temporaires (revert explicite d'une
// première version qui était partie dans cette direction, à tort). "=kick"/
// "=move" délèguent aux commandes déjà existantes et testées
// (utils/serverExtra.js::voicekick/mv, même permission server.voice.manage) ;
// "=mute"/"=unmute"/"=deaf"/"=undeaf" (utils/serverExtra.js) sont neufs mais
// suivent exactement le même patron — même permission, mêmes helpers
// (parseTarget/fetchTargetOrReply), aucune notion de salon "à soi".

/**
 * Un seul dispatcher pour tous les mots vocaux sur "=" ci-dessus — même
 * patron que utils/securityAliases.js::handleSecurityAliasTextCommand.
 * "=owner" (bascule complète) et "=add" (carte granulaire) restent gérés par
 * handleAddAccessTextCommand, un handler indépendant. Require PARESSEUX
 * exprès (à l'intérieur de la fonction) : utils/serverExtra.js requiert déjà
 * CE fichier (requestConfirmation) — un require en haut de fichier créerait
 * un cycle où les fonctions vocales vaudraient `undefined` à l'exécution
 * (serverExtra.js n'aurait pas fini de se charger au moment du require) ;
 * lu ici, au moment de l'APPEL plutôt que du chargement du module, il
 * résout correctement.
 */
async function handleVoiceAliasTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const { owner: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
  const serverExtra = require("./serverExtra");
  const VOICE_ALIASES = {
    mute: serverExtra.voicemute,
    unmute: serverExtra.voiceunmute,
    deaf: serverExtra.voicedeaf,
    undeaf: serverExtra.voiceundeaf,
    disconnect: serverExtra.voicekick,
    move: serverExtra.mv,
    mv: serverExtra.mv,
    find: serverExtra.voicefind,
    bringall: serverExtra.bringall,
    wakeup: serverExtra.voicewakeup,
    join: serverExtra.voicejoin,
  };
  const handler = VOICE_ALIASES[(cmd || "").toLowerCase()];
  if (!handler) return; // mot inconnu sur ce préfixe (ou "add") : silence

  return handler(client, message, args);
}

module.exports = {
  owners,
  access,
  handleAddAccessTextCommand,
  ownerModeration,
  sysAdd,
  sysRemove,
  handleSecurityOwnerTextCommand,
  antinuke,
  whitelist,
  allbots,
  handleServerAdminInteraction,
  roleAdmin,
  limitRole,
  channelAdmin,
  dero,
  applyDeroToNewChannel,
  handleVoiceAliasTextCommand,
  handleConfirmInteraction,
  requestConfirmation,
  ROLE_ADMIN_SUBCOMMANDS,
  CHANNEL_ADMIN_SUBCOMMANDS,
  ID,
};
