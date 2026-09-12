const {
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ContainerBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const confessStore = require("./confessStore");
const { can } = require("./permissions/engine");
const { report } = require("./moderation/actions");
const { buildCarteVisuelle, buildCarteVisuelleConfession } = require("./confessCard");

// !!confess — confessions anonymes, avec VALIDATION avant publication
// (sixième refonte, demande explicite — "on va changer de méthode") :
//
//  Membre -> confession -> ⏳ en attente -> salon de validation PRIVÉ
//    -> 🟢 Accepter -> 📜 publication publique
//    -> 🔴 Refuser -> ❌ jamais publiée
//
//  - "!!confess setup" installe le panneau public "Confesse-toi" (design
//    inchangé : image, texte d'accroche, bouton "Je souhaite participer").
//  - "!!confess validation" configure le salon PRIVÉ où chaque confession
//    arrive comme SON PROPRE message, avec ses boutons 🟢 Accepter / 🔴
//    Refuser — remplace le menu déroulant intégré au panneau des refontes
//    précédentes (retiré : deux systèmes qui font la même chose n'ont pas
//    lieu d'exister ensemble).
//  - Qui peut Accepter/Refuser (et qui peut écrire dans le salon public) :
//    la permission "server.confessions.manage" du système EXISTANT de
//    &panel > Permissions (utils/permissions/catalog.js) OU un
//    administrateur Discord — jamais un rôle codé en dur.
//  - Une confession déjà traitée ne peut plus l'être une seconde fois
//    (bascule atomique "attente" -> décision, voir confessStore::moderer) :
//    si un second clic arrive après coup, il reçoit "déjà traitée", jamais
//    une double décision.
//  - AUCUNE information sur l'auteur n'apparaît dans le salon PUBLIC si la
//    confession est anonyme. Le salon de VALIDATION, lui, montre l'auteur
//    au staff (donnée interne de modération, demande explicite) — chaque
//    décision est aussi journalisée via utils/moderation/actions.js::report
//    (même salon de logs "modération" que kick/ban/etc.).
//
// Toujours sur le préfixe "!!" déjà utilisé par utils/personalProtection.js —
// même mécanique de lecture du préfixe, un mot différent après ("confess" au
// lieu de "panel"), donc les deux coexistent sans jamais se marcher dessus.

const CUSTOM_ID = "confess";
const LONGUEUR_MAX = 4000; // marge sous la limite réelle de description d'embed (4096) — aussi la limite max d'un champ de modale

// Clé du catalogue de permissions existant (utils/permissions/catalog.js),
// configurable depuis &panel > Permissions comme n'importe quelle autre —
// AUCUN rôle codé en dur (demande explicite).
const PERM_GERER = "server.confessions.manage";

// État des flux en cours, EN MÉMOIRE (comme utils/messageOwner.js) : un
// redémarrage du bot en plein milieu d'une confession force juste à
// recommencer, ça n'a pas besoin de survivre sur disque. Les confessions
// déjà envoyées, elles, sont persistées (utils/confessStore.js) — perdre
// celles-là serait perdre un vrai message d'un membre, et les boutons
// Accepter/Refuser doivent continuer à marcher même après un redémarrage
// (l'id de la confession voyage dans le customId, pas dans une session).
// userId -> { guildId, etape: "attente_modal"|"anonymat", texte? }
const enCours = new Map();

/**
 * Le panneau public "Confesse-toi" — design inchangé (demande explicite) :
 * image en dégradé, texte d'accroche, UN SEUL bouton de participation. Plus
 * aucune gestion intégrée ici (voir l'en-tête du fichier) : la validation se
 * passe entièrement dans le salon privé dédié.
 */
function buildConfessCard() {
  const { fichier, galerie } = buildCarteVisuelle("Confesse-toi", { hauteur: 320, texteAlternatif: "Confesse-toi — envoie un message anonyme" });

  const conteneur = new ContainerBuilder()
    .addMediaGalleryComponents(galerie)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "Tu as quelque chose à avouer ? C'est ici que ça se passe.",
          "",
          "Envoie ton **message anonyme** — tu choisis si tu restes **anonyme** ou non. Tout se passe via le bot.",
          "",
          "**Comment participer ?**",
          "**1.** Clique sur le bouton ci-dessous",
          "**2.** Écris ton message anonyme dans la fenêtre qui s'ouvre",
          "**3.** Choisis si tu veux rester anonyme ou non",
          "**4.** Attends la validation — puis c'est publié !",
        ].join("\n")
      )
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "💞 En participant tu confirmes avoir l'âge légal requis et acceptes que ton contenu soit visible par les membres du serveur."
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:start`).setLabel("Je souhaite participer").setStyle(ButtonStyle.Primary).setEmoji("➡️")
      )
    );
  return { flags: MessageFlags.IsComponentsV2, components: [conteneur], files: [fichier] };
}

// Vert/rouge/orange Discord standard (mêmes teintes que les boutons Success/
// Danger) : la bordure du conteneur donne le statut d'un coup d'œil, sans
// avoir à lire le texte — utile quand plusieurs confessions s'empilent dans
// le salon de validation.
function couleurStatut(c) {
  if (c.status === "acceptee") return 0x57f287;
  if (c.status === "refusee") return 0xed4245;
  return 0xfaa61a;
}

function libelleStatut(c) {
  if (c.status === "acceptee") return "✅ Acceptée";
  if (c.status === "refusee") return "❌ Refusée";
  return "⏳ En attente";
}

/**
 * Le message du salon de VALIDATION (privé, staff) — un message par
 * confession, avec ses propres boutons. Montre l'auteur (donnée interne de
 * modération, voir l'en-tête du fichier) : ce n'est PAS le salon public.
 * Les boutons Accepter/Refuser ne sont présents que tant que "attente" —
 * une fois tranchée, le message est édité (voir cette même fonction) pour
 * les retirer et afficher le résultat.
 */
function buildValidationCard(c) {
  const infos = [
    `**Auteur :** <@${c.authorId}> (${c.authorTag})`,
    `**Reste anonyme ?** ${c.anonyme ? "Oui" : "Non — pseudo affiché"}`,
    `**Envoyée :** <t:${Math.floor(c.createdAt / 1000)}:R>`,
    `**Statut :** ${libelleStatut(c)}`,
  ];
  if (c.moderatedBy) infos.push(`**Traitée par :** <@${c.moderatedBy}> (<t:${Math.floor(c.moderatedAt / 1000)}:R>)`);

  const conteneur = new ContainerBuilder()
    .setAccentColor(couleurStatut(c))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([`**📨 Confession #${c.id}**`, "", `> ${c.texte}`].join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(infos.join("\n")));

  if (c.status === "attente") {
    conteneur.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:accepter:${c.id}`).setLabel("Accepter").setStyle(ButtonStyle.Success).setEmoji("🟢"),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:refuser:${c.id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger).setEmoji("🔴")
      )
    );
  }
  return { flags: MessageFlags.IsComponentsV2, components: [conteneur] };
}

/**
 * Publie la confession dans le salon public. Même carte visuelle que
 * l'accroche (utils/confessCard.js) : le message DEVIENT le gros texte du
 * bas de la carte. Pas de légende sous l'image : la publication publique ne
 * montre JAMAIS l'auteur, même pour une confession non-anonyme (le pseudo
 * n'a jamais été affiché publiquement dans ce système — seul le staff, dans
 * le salon de validation, sait qui a écrit quoi). Aucun MP n'est envoyé.
 * @returns le message envoyé, ou null en cas d'échec (salon inaccessible...)
 */
async function publierConfession(salon, donnees) {
  const { fichier, galerie } = buildCarteVisuelleConfession(donnees.texte, { hauteur: 260 });
  return salon.send({ flags: MessageFlags.IsComponentsV2, components: [galerie], files: [fichier] }).catch(() => null);
}

/** Un administrateur Discord, ou la permission dédiée (&panel > Permissions) — même définition partout dans ce fichier. */
function estAutorise(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || can(member, PERM_GERER));
}

/**
 * Protection du salon PUBLIC de confession (inchangée) : seuls les membres
 * autorisés (voir estAutorise) et le bot peuvent y écrire — tout le reste
 * est supprimé INSTANTANÉMENT. Les commandes "!!confess ..." elles-mêmes ne
 * passent jamais par ici (voir handleConfessTextCommand).
 */
async function appliquerGardeSalon(message) {
  if (estAutorise(message.member)) return;
  await message.delete().catch(() => {});
}

/** "!!confess setup" (panneau public) / "!!confess validation" (salon privé de validation) — les deux seules commandes texte. */
async function handleConfessTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  const aLePrefixe = Boolean(PREFIX) && content.startsWith(PREFIX);
  const reste = aLePrefixe ? content.slice(PREFIX.length).trim() : "";
  const [mot, sous] = aLePrefixe ? reste.split(/\s+/) : [];
  const estCommandeConfess = aLePrefixe && (mot || "").toLowerCase() === "confess";

  if (!estCommandeConfess) {
    // Pas une commande "!!confess" : simple message dans le salon — soumis
    // à la garde d'écriture si ce salon EST le salon public de confession.
    const { channelId } = confessStore.getConfig(message.guild.id);
    if (channelId && message.channel.id === channelId) await appliquerGardeSalon(message);
    return;
  }

  const sousCmd = (sous || "").toLowerCase();

  if (sousCmd === "setup") {
    if (!can(message.member, "channels.manage")) {
      return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
    }
    confessStore.setChannel(message.guild.id, message.channel.id);
    return message.channel.send(buildConfessCard()).catch(() => {});
  }

  if (sousCmd === "validation") {
    if (!can(message.member, "channels.manage")) {
      return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
    }
    confessStore.setValidationChannel(message.guild.id, message.channel.id);
    return message
      .reply("Ce salon recevra désormais chaque confession à valider (🟢 Accepter / 🔴 Refuser) avant sa publication.")
      .catch(() => {});
  }

  // mot inconnu après "confess" : silence, comme "panel"
}

async function handleConfessInteraction(interaction) {
  const [, action, ...reste] = interaction.customId.split(":");

  if (action === "start") {
    // Un clic ici écrase toujours l'état précédent (pas de garde "déjà en
    // cours") : sans ça, quelqu'un qui ferme la fenêtre de message sans la
    // valider restait bloqué pour toujours, la seule sortie étant un
    // redémarrage du bot — bug réel rencontré en production.
    enCours.set(interaction.user.id, { guildId: interaction.guild.id, etape: "attente_modal" });
    // Le message se tape ICI, dans une fenêtre Discord — jamais en MP
    // (demande explicite). showModal() doit être la toute première réponse
    // à CE clic.
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:message`).setTitle("Ta confession anonyme");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("texte")
          .setLabel("Ton message")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(LONGUEUR_MAX)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "message") {
    const etat = enCours.get(interaction.user.id);
    if (!etat || etat.etape !== "attente_modal") {
      return interaction.reply({ content: 'Cette étape a expiré — reclique sur "Je souhaite participer".', flags: MessageFlags.Ephemeral });
    }
    const texte = interaction.fields.getTextInputValue("texte").trim();
    if (!texte) {
      return interaction.reply({ content: 'Message vide — reclique sur "Je souhaite participer" pour recommencer.', flags: MessageFlags.Ephemeral });
    }
    etat.texte = texte;
    etat.etape = "anonymat";
    const boutons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:anon:oui`).setLabel("Rester anonyme").setStyle(ButtonStyle.Secondary).setEmoji("🕶️"),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:anon:non`).setLabel("Afficher mon pseudo").setStyle(ButtonStyle.Secondary).setEmoji("🙈")
    );
    return interaction.reply({
      content: "Veux-tu rester anonyme, ou qu'on affiche ton pseudo à côté de ta confession ?",
      components: [boutons],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === "anon") {
    const etat = enCours.get(interaction.user.id);
    if (!etat || etat.etape !== "anonymat") {
      return interaction.reply({ content: 'Cette étape a expiré — reclique sur "Je souhaite participer" sur le serveur.', flags: MessageFlags.Ephemeral });
    }
    enCours.delete(interaction.user.id);
    const anonyme = reste[0] === "oui";

    const { channelId, validationChannelId } = confessStore.getConfig(etat.guildId);
    if (!channelId) {
      return interaction.update({ content: "Le salon de confessions n'est plus configuré sur ce serveur — abandon.", components: [] });
    }
    if (!validationChannelId) {
      return interaction.update({ content: "Le salon de validation n'est pas configuré sur ce serveur — abandon.", components: [] });
    }
    const guild = interaction.client.guilds.cache.get(etat.guildId);
    const salonValidation = guild?.channels.cache.get(validationChannelId);
    if (!salonValidation?.isTextBased?.()) {
      return interaction.update({ content: "Le salon de validation est introuvable — abandon.", components: [] });
    }

    // JAMAIS de publication automatique ici (demande explicite) : la
    // confession part en attente dans le salon de validation.
    const id = confessStore.addConfession(etat.guildId, {
      texte: etat.texte,
      anonyme,
      authorId: interaction.user.id,
      authorTag: interaction.user.tag,
    });
    const confession = confessStore.getConfession(etat.guildId, id);
    const envoye = await salonValidation.send(buildValidationCard(confession)).catch(() => null);
    if (envoye) confessStore.setModerationMessageId(etat.guildId, id, envoye.id);

    return interaction.update({ content: "C'est envoyé ! Ta confession est en attente de validation.", components: [] });
  }

  if (action === "accepter" || action === "refuser") {
    if (!estAutorise(interaction.member)) {
      return interaction.reply({ content: "❌ Tu n'as pas la permission de gérer les confessions.", flags: MessageFlags.Ephemeral });
    }
    const guildId = interaction.guild.id;
    const id = reste[0];
    const statut = action === "accepter" ? "acceptee" : "refusee";

    // Bascule ATOMIQUE : renvoie null si déjà traitée (ou inconnue) — c'est
    // ce qui empêche qu'une même confession soit acceptée ET refusée si
    // deux personnes cliquent presque en même temps (demande explicite).
    const confession = confessStore.moderer(guildId, id, statut, interaction.user.id);
    if (!confession) {
      return interaction.reply({ content: "❌ Cette confession a déjà été traitée (ou n'existe plus).", flags: MessageFlags.Ephemeral });
    }

    if (statut === "acceptee") {
      const { channelId } = confessStore.getConfig(guildId);
      const salonPublic = channelId ? interaction.guild.channels.cache.get(channelId) : null;
      if (salonPublic?.isTextBased?.()) {
        const publie = await publierConfession(salonPublic, confession);
        if (publie) confessStore.setPublishedMessageId(guildId, id, publie.id);
      }
    }

    await report(interaction.client, {
      guildId,
      category: "moderation",
      title: statut === "acceptee" ? "Confession acceptée" : "Confession refusée",
      fields: [
        { label: "Confession", value: `#${id}` },
        { label: "Auteur", value: `<@${confession.authorId}> (${confession.authorTag})` },
      ],
      action: statut === "acceptee" ? "confess_accept" : "confess_refuse",
      targetId: confession.authorId,
      targetTag: confession.authorTag,
      moderator: interaction.user,
      channelId: interaction.channel?.id || null,
    }).catch((err) => console.error("[confessions] log échoué :", err));

    return interaction.update(buildValidationCard(confession));
  }
}

module.exports = { handleConfessTextCommand, handleConfessInteraction, CUSTOM_ID };
