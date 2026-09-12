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
// Cinquième refonte (demande explicite, confirmée malgré la mise en garde
// donnée sur ce point précis) :
//  - "!!confess setup" reste la SEULE commande texte : elle installe le
//    panneau public "Confesse-toi".
//  - La gestion (menu déroulant, détail, Publier/Refuser/Retour/Fermer) est
//    INTÉGRÉE à ce MÊME panneau — jamais un message séparé, ni éphémère.
//    Cliquer "Gérer les confessions" (ou Retour/choisir/Publier/Refuser)
//    transforme le VRAI panneau public EN PLACE (interaction.update sur le
//    message du salon), donc pour TOUT LE MONDE qui le regarde à cet
//    instant — pas seulement pour qui a cliqué. C'est un compromis assumé
//    et confirmé explicitement : Discord ne permet techniquement pas à un
//    même message d'afficher un contenu différent selon qui le regarde,
//    donc "intégré au panneau" et "invisible aux non-autorisés" ne peuvent
//    pas être vrais en même temps — celui-ci a été choisi.
//  - Qui peut VOIR/GÉRER (ouvrir/menu/Publier/Refuser/Retour/Fermer) ET qui
//    peut ÉCRIRE dans le salon dépendent TOUS LES DEUX de la MÊME
//    permission "server.confessions.manage" du système EXISTANT de &panel >
//    Permissions (utils/permissions/catalog.js) — plusieurs personnes
//    possibles, pas un utilisateur unique codé en dur. Un clic sans cette
//    permission reçoit un refus éphémère et NE MODIFIE PAS le panneau.
//  - AUCUNE information permettant d'identifier l'auteur (pseudo, ID,
//    mention, avatar...) n'apparaît JAMAIS dans l'interface de gestion,
//    même pour qui a la permission — demande explicite. L'auteur reste
//    connu EN INTERNE (authorId/authorTag persistés, pour une éventuelle
//    modération) mais n'est JAMAIS contacté par MP (demande explicite).
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
// AUCUN rôle codé en dur (demande explicite).
const PERM_GERER = "server.confessions.manage";

// État des flux en cours, EN MÉMOIRE (comme utils/messageOwner.js) : un
// redémarrage du bot en plein milieu d'une confession force juste à
// recommencer, ça n'a pas besoin de survivre sur disque. Les confessions
// déjà envoyées, elles, sont persistées (utils/confessStore.js::pending) —
// perdre celles-là serait perdre un vrai message d'un membre.
// userId -> { guildId, etape: "attente_modal"|"anonymat", texte? }
const enCours = new Map();

/**
 * Le panneau "Confesse-toi" — UN SEUL ContainerBuilder qui regroupe TOUT :
 * l'image, le texte d'accroche, les boutons, ET (selon `vue`) la zone de
 * gestion. Trois états :
 *  - `vue` absent : panneau de base, juste les boutons "Je souhaite
 *    participer" / "Gérer les confessions" (état posté par "!!confess
 *    setup", et celui après "Fermer").
 *  - `vue: "liste"` : ajoute le menu déroulant des confessions en attente.
 *  - `vue: "detail"` avec `detail` : ajoute le contenu d'UNE confession et
 *    les boutons Publier/Refuser/Retour/Fermer.
 */
function buildConfessCard(guildId, { vue, detail } = {}) {
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

  if (vue === "detail" && detail) {
    conteneur.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    // Le contenu ET "Reste anonyme ?" — JAMAIS l'auteur, sous aucune forme
    // (pseudo, ID, mention...) : demande explicite, même pour qui gère.
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
  } else if (vue === "liste") {
    conteneur.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
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

  return { flags: MessageFlags.IsComponentsV2, components: [conteneur], files: [fichier] };
}

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
 * Protection du salon de confession (demande explicite) : seuls les membres
 * ayant la permission PERM_GERER (via &panel > Permissions) et les
 * administrateurs Discord peuvent y écrire — tout le reste est supprimé
 * INSTANTANÉMENT. Les commandes "!!confess ..." elles-mêmes ne passent
 * jamais par ici (voir handleConfessTextCommand) : leurs propres
 * vérifications de permission suffisent, pas la peine de les supprimer en
 * plus si elles échouent.
 */
async function appliquerGardeSalon(message) {
  const autorise = message.member?.permissions?.has(PermissionFlagsBits.Administrator) || can(message.member, PERM_GERER);
  if (autorise) return;
  await message.delete().catch(() => {});
}

/** "!!confess setup" — la SEULE commande texte : installe le panneau public "Confesse-toi" (gestion intégrée dedans, voir buildConfessCard). */
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
    const { channelId } = confessStore.getConfig(message.guild.id);
    if (channelId && message.channel.id === channelId) await appliquerGardeSalon(message);
    return;
  }

  const sousCmd = (sous || "").toLowerCase();
  if (sousCmd !== "setup") return; // mot inconnu après "confess" : silence, comme "panel"

  if (!can(message.member, "channels.manage")) {
    return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
  }
  confessStore.setChannel(message.guild.id, message.channel.id);
  return message.channel.send(buildConfessCard(message.guild.id)).catch(() => {});
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

    const { channelId } = confessStore.getConfig(etat.guildId);
    if (!channelId) {
      return interaction.update({ content: "Le salon de confessions n'est plus configuré sur ce serveur — abandon.", components: [] });
    }

    // JAMAIS de publication automatique ici (demande explicite) : la
    // confession rejoint la file d'attente, gérée depuis le panneau public.
    confessStore.addPending(etat.guildId, { texte: etat.texte, anonyme, authorId: interaction.user.id, authorTag: interaction.user.tag });
    return interaction.update({ content: "C'est envoyé ! Ta confession est en attente de publication.", components: [] });
  }

  if (action === "gerer") {
    const guildId = interaction.guild.id;
    if (!can(interaction.member, PERM_GERER)) {
      // Refus éphémère : celui-ci reste privé, mais NE MODIFIE PAS le
      // panneau public — quelqu'un sans la permission ne peut pas le
      // transformer, même en échouant.
      return interaction.reply({ content: "❌ Tu n'as pas la permission de gérer les messages anonymes.", flags: MessageFlags.Ephemeral });
    }
    const [sousAction, id] = reste;

    // Toutes les actions ci-dessous transforment le VRAI panneau (interaction
    // vient d'un clic dessus) : visible par tout le monde dans le salon, pas
    // seulement par qui clique — compromis assumé, voir l'en-tête du fichier.
    if (sousAction === "ouvrir" || sousAction === "retour") {
      return interaction.update(buildConfessCard(guildId, { vue: "liste" }));
    }

    if (sousAction === "fermer") {
      return interaction.update(buildConfessCard(guildId));
    }

    if (sousAction === "choisir") {
      const item = confessStore.getPendingById(guildId, interaction.values[0]);
      return interaction.update(buildConfessCard(guildId, item ? { vue: "detail", detail: item } : { vue: "liste" }));
    }

    if (sousAction === "publier" || sousAction === "refuser") {
      const item = confessStore.getPendingById(guildId, id);
      if (!item) return interaction.update(buildConfessCard(guildId, { vue: "liste" }));
      // Retirée de la file AVANT publication : un double-clic ne doit
      // jamais pouvoir publier deux fois la même confession.
      confessStore.removePending(guildId, id);

      if (sousAction === "publier") {
        const { channelId } = confessStore.getConfig(guildId);
        const salonPublic = channelId ? interaction.guild.channels.cache.get(channelId) : null;
        if (salonPublic?.isTextBased?.()) await publierConfession(salonPublic, item);
      }

      return interaction.update(buildConfessCard(guildId, { vue: "liste" }));
    }
    return;
  }
}

module.exports = { handleConfessTextCommand, handleConfessInteraction, CUSTOM_ID };
