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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const confessStore = require("./confessStore");
const { can } = require("./permissions/engine");
const { buildCarteVisuelle, buildCarteVisuelleConfession } = require("./confessCard");

// !!confess — confessions anonymes, reproduisant le déroulé montré en
// capture par l'utilisateur : carte "Confesse-toi", bouton "Je souhaite
// participer" -> message anonyme (modale, jamais en MP — demande explicite
// "je veux plus que les messages soient en dm") -> choix de rester anonyme
// ou non -> mise en attente -> publication MANUELLE.
//
// Troisième refonte (demande explicite) :
//  - "!!confess setup" reste la SEULE commande texte : elle installe le
//    panneau public "Confesse-toi" ET fait de son AUTEUR le seul gestionnaire
//    de ce panneau (confessStore::setupAuthorId) — pas une permission
//    partagée, un utilisateur précis.
//  - Le panneau public ne montre JAMAIS le contenu des confessions en
//    attente : personne d'autre que le gestionnaire ne doit pouvoir le voir.
//    Il porte juste un bouton "📩 Gérer les confessions" ; cliquer dessus
//    ouvre la liste (menu déroulant, détail, Publier/Refuser/Retour/Fermer)
//    en réponse ÉPHÉMÈRE — visible uniquement par le gestionnaire, jamais
//    posée dans le salon (voir buildGestionVue).
//  - Qui peut ÉCRIRE dans le salon (pas gérer : juste discuter) reste régi
//    par la permission "server.confessions.manage" du système EXISTANT de
//    &panel > Permissions (utils/permissions/catalog.js) OU par le fait
//    d'être le gestionnaire OU administrateur — voir appliquerGardeSalon.
//  - AUCUNE information permettant d'identifier l'auteur (pseudo, ID,
//    mention, avatar...) n'apparaît JAMAIS dans l'interface de gestion,
//    même pour le gestionnaire — demande explicite. L'auteur reste connu EN
//    INTERNE (authorId/authorTag persistés, pour une éventuelle modération)
//    mais n'est JAMAIS contacté par MP (demande explicite).
//
// Pas de réactions automatiques (demande explicite) : le vote 👍/👎 posé
// automatiquement a été retiré — rien n'empêche qui veut réagir de le faire
// lui-même. La confession PUBLIÉE (publierConfession), elle, n'a toujours
// aucun cadre — juste l'image, voir plus bas.
//
// Toujours sur le préfixe "!!" déjà utilisé par utils/personalProtection.js —
// même mécanique de lecture du préfixe, un mot différent après ("confess" au
// lieu de "panel"), donc les deux coexistent sans jamais se marcher dessus.

const CUSTOM_ID = "confess";
const LONGUEUR_MAX = 4000; // marge sous la limite réelle de description d'embed (4096) — aussi la limite max d'un champ de modale

// Clé du catalogue de permissions existant (utils/permissions/catalog.js),
// configurable depuis &panel > Permissions comme n'importe quelle autre —
// gouverne qui peut ÉCRIRE dans le salon, pas qui peut gérer (voir plus haut).
const PERM_GERER = "server.confessions.manage";

// État des flux en cours, EN MÉMOIRE (comme utils/messageOwner.js) : un
// redémarrage du bot en plein milieu d'une confession force juste à
// recommencer, ça n'a pas besoin de survivre sur disque. Les confessions
// déjà envoyées, elles, sont persistées (utils/confessStore.js::pending) —
// perdre celles-là serait perdre un vrai message d'un membre.
// userId -> { guildId, etape: "attente_modal"|"anonymat", texte? }
const enCours = new Map();

/**
 * Le panneau public "Confesse-toi" — UN SEUL ContainerBuilder : l'image en
 * dégradé, le texte d'accroche, et les deux boutons. AUCUN contenu de
 * confession en attente ici (demande explicite) : "Gérer les confessions"
 * n'ouvre qu'une vue éphémère (voir buildGestionVue), jamais posée dans le
 * salon.
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
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:start`).setLabel("Je souhaite participer").setStyle(ButtonStyle.Primary).setEmoji("➡️"),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:ouvrir`).setLabel("Gérer les confessions").setStyle(ButtonStyle.Secondary).setEmoji("📩")
      )
    );
  return { flags: MessageFlags.IsComponentsV2, components: [conteneur], files: [fichier] };
}

/**
 * La vue de gestion — TOUJOURS envoyée en réponse ÉPHÉMÈRE (jamais posée
 * dans le salon, voir l'en-tête du fichier) : c'est ce qui garantit que
 * personne d'autre que le gestionnaire ne voit le contenu des confessions
 * en attente. `detail`, si fourni, est LA confession actuellement affichée
 * pour publication/refus ; sans lui, la vue montre le menu déroulant listant
 * toutes les confessions en attente.
 */
function buildGestionVue(guildId, { detail } = {}) {
  const conteneur = new ContainerBuilder();

  if (detail) {
    // Le contenu ET "Reste anonyme ?" — JAMAIS l'auteur, sous aucune forme
    // (pseudo, ID, mention...) : demande explicite, même pour le gestionnaire.
    conteneur.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [`**📩 Confession #${detail.id}**`, "", detail.texte, "", `**Reste anonyme :** ${detail.anonyme ? "Oui" : "Non"}`].join("\n")
      )
    );
    conteneur.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:publier:${detail.id}`).setLabel("Publier").setStyle(ButtonStyle.Success).setEmoji("📤"),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:refuser:${detail.id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger).setEmoji("🗑️"),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:retour`).setLabel("Retour").setStyle(ButtonStyle.Secondary).setEmoji("↩️"),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:fermer`).setLabel("Fermer").setStyle(ButtonStyle.Secondary).setEmoji("❌")
      )
    );
  } else {
    conteneur.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("**📩 Messages anonymes en attente**\nSélectionne un message à publier.")
    );
    const pending = confessStore.getPending(guildId);
    if (!pending.length) {
      conteneur.addTextDisplayComponents(new TextDisplayBuilder().setContent("*Aucune confession en attente pour le moment.*"));
    } else {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:gerer:choisir`)
        .setPlaceholder("Choisir une confession...")
        .addOptions(
          pending.slice(0, 25).map((p) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`📩 Confession #${p.id}`)
              .setDescription(p.texte.slice(0, 100))
              .setValue(p.id)
          )
        );
      conteneur.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    }
  }

  return { flags: MessageFlags.IsComponentsV2, components: [conteneur] };
}

const VUE_FERMEE = {
  flags: MessageFlags.IsComponentsV2,
  components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Panneau fermé."))],
};

/**
 * Publie la confession dans le salon public. Même carte visuelle que
 * l'accroche (utils/confessCard.js) : le message DEVIENT le gros texte du
 * bas de la carte, exactement comme sur la référence fournie ("Baisons eren
 * les amis"). Ni cadre gris ni réaction automatique — voir l'en-tête du
 * fichier. Pas de légende sous l'image non plus : la publication publique
 * ne montre jamais l'auteur. Aucun MP n'est envoyé ici (demande explicite) :
 * ni à l'auteur, ni à qui que ce soit d'autre.
 */
async function publierConfession(salon, donnees) {
  const { fichier, galerie } = buildCarteVisuelleConfession(donnees.texte, { hauteur: 420 });
  return salon.send({ flags: MessageFlags.IsComponentsV2, components: [galerie], files: [fichier] }).catch(() => null);
}

/**
 * Protection du salon de confession (demande explicite) : seuls le
 * gestionnaire (auteur du "!!confess setup"), les membres ayant la
 * permission PERM_GERER (via &panel > Permissions), les administrateurs
 * Discord et le bot peuvent y écrire — tout le reste est supprimé
 * INSTANTANÉMENT. Les commandes "!!confess ..." elles-mêmes ne passent
 * jamais par ici (voir handleConfessTextCommand) : leurs propres
 * vérifications de permission suffisent, pas la peine de les supprimer en
 * plus si elles échouent.
 */
async function appliquerGardeSalon(message, setupAuthorId) {
  const autorise =
    message.author.id === setupAuthorId ||
    message.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    can(message.member, PERM_GERER);
  if (autorise) return;
  await message.delete().catch(() => {});
}

/** "!!confess setup" — la SEULE commande texte : installe le panneau public "Confesse-toi" et fait de son auteur LE gestionnaire (seul à pouvoir gérer, voir l'en-tête du fichier). */
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
    // à la garde d'écriture si ce salon EST le salon de confession.
    const { channelId, setupAuthorId } = confessStore.getConfig(message.guild.id);
    if (channelId && message.channel.id === channelId) await appliquerGardeSalon(message, setupAuthorId);
    return;
  }

  const sousCmd = (sous || "").toLowerCase();
  if (sousCmd !== "setup") return; // mot inconnu après "confess" : silence, comme "panel"

  if (!can(message.member, "channels.manage")) {
    return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
  }
  confessStore.setChannel(message.guild.id, message.channel.id, message.author.id);
  return message.channel.send(buildConfessCard()).catch(() => {});
}

async function handleConfessInteraction(interaction) {
  const [, action, ...reste] = interaction.customId.split(":");

  if (action === "start") {
    if (enCours.has(interaction.user.id)) {
      return interaction.reply({ content: "Tu as déjà une confession en cours.", flags: MessageFlags.Ephemeral });
    }
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

    const { channelId } = confessStore.getConfig(etat.guildId);
    if (!channelId) {
      return interaction.update({ content: "Le salon de confessions n'est plus configuré sur ce serveur — abandon.", components: [] });
    }

    // JAMAIS de publication automatique ici (demande explicite) : la
    // confession rejoint la file d'attente, gérée depuis "Gérer les
    // confessions" par le seul gestionnaire (voir l'en-tête du fichier).
    confessStore.addPending(etat.guildId, { texte: etat.texte, anonyme, authorId: interaction.user.id, authorTag: interaction.user.tag });
    return interaction.update({ content: "C'est envoyé ! Ta confession est en attente de publication.", components: [] });
  }

  if (action === "gerer") {
    const guildId = interaction.guild.id;
    const { setupAuthorId } = confessStore.getConfig(guildId);
    if (interaction.user.id !== setupAuthorId) {
      return interaction.reply({ content: "❌ Tu n'as pas la permission de gérer les messages anonymes.", flags: MessageFlags.Ephemeral });
    }
    const [sousAction, id] = reste;

    if (sousAction === "ouvrir") {
      // PREMIÈRE réponse à ce bouton : reply() éphémère, pas update() — rien
      // à mettre à jour, et c'est cette réponse qui doit rester invisible à
      // quiconque n'est pas le gestionnaire (demande explicite).
      return interaction.reply({ ...buildGestionVue(guildId), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    if (sousAction === "fermer") {
      return interaction.update(VUE_FERMEE);
    }

    if (sousAction === "retour") {
      return interaction.update(buildGestionVue(guildId));
    }

    if (sousAction === "choisir") {
      const item = confessStore.getPendingById(guildId, interaction.values[0]);
      return interaction.update(buildGestionVue(guildId, { detail: item || undefined }));
    }

    if (sousAction === "publier" || sousAction === "refuser") {
      const item = confessStore.getPendingById(guildId, id);
      if (!item) return interaction.update(buildGestionVue(guildId));
      // Retirée de la file AVANT publication : un double-clic ne doit
      // jamais pouvoir publier deux fois la même confession.
      confessStore.removePending(guildId, id);

      if (sousAction === "publier") {
        const { channelId } = confessStore.getConfig(guildId);
        const salonPublic = channelId ? interaction.guild.channels.cache.get(channelId) : null;
        if (salonPublic?.isTextBased?.()) await publierConfession(salonPublic, item);
      }

      return interaction.update(buildGestionVue(guildId));
    }
    return;
  }
}

module.exports = { handleConfessTextCommand, handleConfessInteraction, CUSTOM_ID };
