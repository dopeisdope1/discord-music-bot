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
// ou non -> mise en attente -> publication MANUELLE par un gestionnaire.
//
// Refonte "en profondeur" (demande explicite, remplace l'ancien salon de
// validation staff) :
//  - "!!confess setup" configure seulement le panneau public (inchangé).
//  - "!!confess role @rôle" configure le rôle dispensé du blocage d'écriture.
//  - "!!confess" (seul) fait de son auteur LE gestionnaire de la session :
//    lui seul peut ensuite publier/refuser les confessions en attente.
//  - Le message d'un participant n'est JAMAIS publié automatiquement : il
//    rejoint une file d'attente (utils/confessStore.js::pending) que seul le
//    gestionnaire consulte via un menu déroulant, avant de choisir Publier
//    ou Refuser.
//  - Le salon de confession est protégé : tout message qui n'est pas du
//    gestionnaire, d'un administrateur Discord, d'un membre du rôle "perm
//    confess" ou du bot est supprimé instantanément (voir appliquerGardeSalon).
//
// Pas de réactions automatiques (demande explicite) : le vote 👍/👎 posé
// automatiquement a été retiré — rien n'empêche qui veut réagir de le faire
// lui-même. La confession PUBLIÉE (publierConfession), elle, n'a toujours
// aucun cadre — juste l'image, voir plus bas.
//
// La carte "Confesse-toi", en revanche, a bien un cadre : tout le texte (et
// les boutons) est dans UN SEUL ContainerBuilder, comme sur les captures de
// référence fournies (fond + bordure grise sur toute la hauteur du bloc,
// image du dégradé comprise) — design volontairement inchangé par cette
// refonte, demande explicite.
//
// Toujours sur le préfixe "!!" déjà utilisé par utils/personalProtection.js —
// même mécanique de lecture du préfixe, un mot différent après ("confess" au
// lieu de "panel"), donc les deux coexistent sans jamais se marcher dessus.

const CUSTOM_ID = "confess";
const LONGUEUR_MAX = 4000; // marge sous la limite réelle de description d'embed (4096) — aussi la limite max d'un champ de modale

// État des flux en cours, EN MÉMOIRE (comme utils/messageOwner.js) : un
// redémarrage du bot en plein milieu d'une confession force juste à
// recommencer, ça n'a pas besoin de survivre sur disque. Les confessions
// déjà envoyées, elles, sont persistées (utils/confessStore.js::pending) —
// perdre celles-là serait perdre un vrai message d'un membre.
// userId -> { guildId, etape: "attente_modal"|"anonymat", texte? }
const enCours = new Map();

/**
 * La carte d'accroche : UN SEUL ContainerBuilder qui regroupe TOUT — l'image
 * en dégradé (utils/confessCard.js), le texte, le séparateur, le disclaimer
 * et les boutons — fond + bordure GRISE (pas de couleur d'accent, demande
 * explicite) sur toute la hauteur du bloc, comme sur les captures de
 * référence fournies (plusieurs bots comparés côte à côte pour ce rendu).
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
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:notif`).setLabel("Gérer les notifications").setStyle(ButtonStyle.Secondary).setEmoji("🔔")
      )
    );
  return { flags: MessageFlags.IsComponentsV2, components: [conteneur], files: [fichier] };
}

/**
 * Interface du gestionnaire (celui qui a lancé "!!confess") — vue "liste" :
 * un menu déroulant listant les confessions en attente, une par option.
 */
function buildManagerListView(guildId) {
  const pending = confessStore.getPending(guildId);
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("**📩 Messages anonymes en attente**\nSélectionne un message à publier.")
  );

  if (!pending.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("*Aucune confession en attente pour le moment.*"));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

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
  container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Vue "détail" — le contenu complet d'UNE confession en attente, avec les actions du gestionnaire. */
function buildManagerDetailView(item) {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**📩 Confession #${item.id}**`,
        "",
        item.texte,
        "",
        `**Auteur :** ${item.authorTag}`,
        `**Reste anonyme ?** ${item.anonyme ? "Oui" : "Non — pseudo affiché"}`,
      ].join("\n")
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:publier:${item.id}`).setLabel("Publier").setStyle(ButtonStyle.Success).setEmoji("📤"),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:refuser:${item.id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger).setEmoji("🗑️"),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:retour`).setLabel("Retour").setStyle(ButtonStyle.Secondary).setEmoji("↩️"),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:gerer:fermer`).setLabel("Fermer").setStyle(ButtonStyle.Secondary).setEmoji("❌")
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

const PANNEAU_FERME = {
  flags: MessageFlags.IsComponentsV2,
  components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("Panneau fermé."))],
};

/**
 * Publie la confession dans le salon public. Même carte visuelle que
 * l'accroche (utils/confessCard.js) : le message DEVIENT le gros texte du
 * bas de la carte, exactement comme sur la référence fournie ("Baisons eren
 * les amis"). Ni cadre gris ni réaction automatique — voir l'en-tête du
 * fichier. Pas de légende sous l'image non plus (demande explicite) : le
 * choix anonyme/pseudo ne sert donc plus qu'à l'interface du gestionnaire —
 * la publication publique, elle, ne montre jamais l'auteur.
 */
async function publierConfession(guild, salon, donnees) {
  const { fichier, galerie } = buildCarteVisuelleConfession(donnees.texte, { hauteur: 420 });

  const envoye = await salon
    .send({ flags: MessageFlags.IsComponentsV2, components: [galerie], files: [fichier] })
    .catch(() => null);
  if (!envoye) return null;

  const { notifOptIns } = confessStore.getConfig(guild.id);
  for (const userId of notifOptIns) {
    if (userId === donnees.authorId) continue;
    guild.client.users
      .fetch(userId)
      .then((u) => u.send(`Nouvelle confession publiée dans <#${salon.id}> !`).catch(() => {}))
      .catch(() => {});
  }
  return envoye;
}

/**
 * Protection du salon de confession (demande explicite) : seuls le
 * gestionnaire de la session en cours, les administrateurs Discord, les
 * membres du rôle "perm confess" et le bot peuvent y écrire — tout le reste
 * est supprimé INSTANTANÉMENT, avant même d'être lu comme commande.
 *
 * Ajout au-delà de la demande littérale : un membre disposant de la
 * permission "channels.manage" peut aussi y écrire — sinon il ne pourrait
 * pas lancer "!!confess setup"/"!!confess role"/"!!confess" depuis ce salon
 * lui-même, son propre message se ferait supprimer avant traitement.
 *
 * @returns {Promise<boolean>} true si le message a été supprimé (appelant : ne rien traiter de plus)
 */
async function appliquerGardeSalon(message) {
  const { managerId, permRoleId } = confessStore.getConfig(message.guild.id);
  const autorise =
    message.author.id === managerId ||
    message.member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    (permRoleId && message.member?.roles?.cache?.has(permRoleId)) ||
    can(message.member, "channels.manage");
  if (autorise) return false;
  await message.delete().catch(() => {});
  return true;
}

/**
 * "!!confess setup" (installe le panneau public) / "!!confess role @rôle"
 * (rôle dispensé du blocage d'écriture) / "!!confess" seul (ouvre une
 * session de gestion, l'auteur devient LE gestionnaire).
 */
async function handleConfessTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const { channelId } = confessStore.getConfig(message.guild.id);
  if (channelId && message.channel.id === channelId) {
    if (await appliquerGardeSalon(message)) return;
  }

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const reste = content.slice(PREFIX.length).trim();
  const [mot, sous, ...args] = reste.split(/\s+/);
  if ((mot || "").toLowerCase() !== "confess") return; // mot inconnu sur ce préfixe : silence, comme "panel"

  const sousCmd = (sous || "").toLowerCase();

  if (sousCmd === "setup") {
    if (!can(message.member, "channels.manage")) {
      return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
    }
    confessStore.setChannel(message.guild.id, message.channel.id);
    return message.channel.send(buildConfessCard()).catch(() => {});
  }

  if (sousCmd === "role") {
    if (!can(message.member, "channels.manage")) {
      return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
    }
    const role = message.mentions.roles?.first() || (args[0] ? message.guild.roles.cache.get(args[0]) : null);
    if (!role) {
      return message.reply("Indique un rôle : `!!confess role @rôle`.").catch(() => {});
    }
    confessStore.setPermRole(message.guild.id, role.id);
    return message.reply(`Les membres avec le rôle ${role} peuvent désormais écrire dans le salon de confession.`).catch(() => {});
  }

  if (!sousCmd) {
    if (!can(message.member, "channels.manage")) {
      return message.reply("Tu n'as pas la permission nécessaire pour gérer les confessions.").catch(() => {});
    }
    confessStore.setManager(message.guild.id, message.author.id);
    return message.channel.send(buildManagerListView(message.guild.id)).catch(() => {});
  }
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

    const guild = interaction.client.guilds.cache.get(etat.guildId);
    const { channelId } = confessStore.getConfig(etat.guildId);
    if (!guild || !channelId) {
      return interaction.update({ content: "Le salon de confessions n'est plus configuré sur ce serveur — abandon.", components: [] });
    }

    // JAMAIS de publication automatique ici (demande explicite) : la
    // confession rejoint la file d'attente, seul le gestionnaire décide.
    confessStore.addPending(etat.guildId, { texte: etat.texte, anonyme, authorId: interaction.user.id, authorTag: interaction.user.tag });
    return interaction.update({ content: "C'est envoyé ! Ta confession est en attente de publication par le gestionnaire.", components: [] });
  }

  if (action === "gerer") {
    const { managerId } = confessStore.getConfig(interaction.guild.id);
    if (interaction.user.id !== managerId) {
      return interaction.reply({ content: "❌ Tu n'es pas le gestionnaire de cette session de confession.", flags: MessageFlags.Ephemeral });
    }
    const [sousAction, id] = reste;

    if (sousAction === "retour") {
      return interaction.update(buildManagerListView(interaction.guild.id));
    }

    if (sousAction === "fermer") {
      return interaction.update(PANNEAU_FERME);
    }

    if (sousAction === "choisir") {
      const item = confessStore.getPendingById(interaction.guild.id, interaction.values[0]);
      if (!item) return interaction.update(buildManagerListView(interaction.guild.id));
      return interaction.update(buildManagerDetailView(item));
    }

    if (sousAction === "publier" || sousAction === "refuser") {
      const item = confessStore.getPendingById(interaction.guild.id, id);
      if (!item) return interaction.update(buildManagerListView(interaction.guild.id));
      // Retirée de la file AVANT publication : un double-clic ne doit
      // jamais pouvoir publier deux fois la même confession.
      confessStore.removePending(interaction.guild.id, id);

      if (sousAction === "publier") {
        const { channelId } = confessStore.getConfig(interaction.guild.id);
        const salonPublic = channelId ? interaction.guild.channels.cache.get(channelId) : null;
        if (salonPublic?.isTextBased?.()) await publierConfession(interaction.guild, salonPublic, item);
      }

      const auteur = await interaction.client.users.fetch(item.authorId).catch(() => null);
      if (auteur) {
        await auteur
          .send(sousAction === "publier" ? "Ta confession a été validée et publiée !" : "Ta confession n'a pas été retenue par le gestionnaire.")
          .catch(() => {});
      }
      return interaction.update(buildManagerListView(interaction.guild.id));
    }
    return;
  }

  if (action === "notif") {
    const actif = confessStore.toggleNotif(interaction.guild.id, interaction.user.id);
    return interaction.reply({
      content: actif ? "🔔 Tu recevras un MP à chaque nouvelle confession publiée." : "🔕 Notifications désactivées.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { handleConfessTextCommand, handleConfessInteraction, CUSTOM_ID };
