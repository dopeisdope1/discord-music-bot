const {
  EmbedBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const confessStore = require("./confessStore");
const { can } = require("./permissions/engine");
const { buildCarteVisuelle, buildCarteVisuelleConfession } = require("./confessCard");

// !!confess — confessions anonymes, reproduisant le déroulé montré en
// capture par l'utilisateur : carte "Confesse-toi", bouton "Je souhaite
// participer" -> message anonyme (modale, jamais en MP — demande explicite
// "je veux plus que les messages soient en dm") -> choix de rester anonyme
// ou non -> attente de validation -> publication.
//
// Ni ContainerBuilder ni réactions automatiques : demande explicite ("je
// veux plus... ni de bordure grise ni de reaction") — un ContainerBuilder
// dessine toujours un cadre gris autour de ce qu'il regroupe, donc la carte
// d'accroche et chaque confession publiée envoient leurs composants
// Components V2 (texte, image) DIRECTEMENT au niveau du message, sans
// regroupement visuel. Le vote 👍/👎 posé automatiquement a été retiré au
// même moment — rien n'empêche qui veut réagir de le faire lui-même.
//
// Toujours sur le préfixe "!!" déjà utilisé par utils/personalProtection.js —
// même mécanique de lecture du préfixe, un mot différent après ("confess" au
// lieu de "panel"), donc les deux coexistent sans jamais se marcher dessus.

const CUSTOM_ID = "confess";
const COULEUR = 0xff5e8a; // rose/orangé, dans l'esprit de la capture fournie
const LONGUEUR_MAX = 4000; // marge sous la limite réelle de description d'embed (4096) — aussi la limite max d'un champ de modale

// État des flux en cours, EN MÉMOIRE (comme utils/messageOwner.js) : un
// redémarrage du bot en plein milieu d'une confession force juste à
// recommencer, ça n'a pas besoin de survivre sur disque.
// userId -> { guildId, etape: "attente_modal"|"anonymat", texte? }
const enCours = new Map();

// Confessions envoyées, en attente d'un clic Approuver/Refuser dans le salon
// de validation. id (compteur local) -> { guildId, anonyme, texte, authorId, authorTag }
const enAttenteValidation = new Map();
let prochainIdValidation = 1;

/**
 * La carte d'accroche : carte d'APPLICATION — grands coins arrondis,
 * dégradé, gros texte — PAS un embed Discord classique, PAS de cadre gris
 * de regroupement (voir le commentaire en tête de fichier). Le visuel
 * (utils/confessCard.js) porte l'accroche ; "Comment participer" reste du
 * vrai texte Discord juste en dessous.
 */
function buildConfessCard() {
  const { fichier, galerie } = buildCarteVisuelle("Confesse-toi", { hauteur: 320, texteAlternatif: "Confesse-toi — envoie un message anonyme" });

  const texte = new TextDisplayBuilder().setContent(
    [
      "Tu as quelque chose à avouer ? C'est ici que ça se passe.",
      "",
      "Envoie ton **message anonyme** — tu choisis si tu restes **anonyme** ou non. Tout se passe via le bot.",
      "",
      "**Comment participer ?**",
      "> **1.** Clique sur le bouton ci-dessous",
      "> **2.** Écris ton message anonyme dans la fenêtre qui s'ouvre",
      "> **3.** Choisis si tu veux rester anonyme ou non",
      "> **4.** Attends la validation — puis c'est publié !",
      "",
      "💞 En participant tu confirmes avoir l'âge légal requis et acceptes que ton contenu soit visible par les membres du serveur.",
    ].join("\n")
  );
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:start`).setLabel("Je souhaite participer").setStyle(ButtonStyle.Primary).setEmoji("➡️"),
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:notif`).setLabel("Gérer les notifications").setStyle(ButtonStyle.Secondary).setEmoji("🔔")
  );
  return { flags: MessageFlags.IsComponentsV2, components: [galerie, texte, boutons], files: [fichier] };
}

function buildValidationCard(id, donnees) {
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle("📋 Confession en attente de validation")
    .setDescription(donnees.texte)
    .addFields(
      { name: "Auteur", value: donnees.authorTag, inline: true },
      { name: "Reste anonyme ?", value: donnees.anonyme ? "Oui" : "Non — pseudo affiché", inline: true }
    );
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:valider:approuve:${id}`).setLabel("Approuver").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:valider:refuse:${id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [boutons] };
}

/**
 * Publie la confession dans le salon public. Même carte visuelle que
 * l'accroche (utils/confessCard.js) : le message DEVIENT le gros texte du
 * bas de la carte, exactement comme sur la référence fournie ("Baisons eren
 * les amis"). Ni cadre gris ni réaction automatique — voir l'en-tête du
 * fichier. Pas de légende sous l'image non plus (demande explicite) : le
 * choix anonyme/pseudo ne sert donc plus qu'à la carte de validation, côté
 * staff — la publication publique, elle, ne montre jamais l'auteur.
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
 * `!!confess setup` (salon public) / `!!confess validation` (salon staff où
 * approuver/refuser) — les deux seules commandes texte, tout le reste du
 * parcours se fait par boutons et une modale.
 */
async function handleConfessTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const reste = content.slice(PREFIX.length).trim();
  const [mot, sous] = reste.split(/\s+/);
  if ((mot || "").toLowerCase() !== "confess") return; // mot inconnu sur ce préfixe : silence, comme "panel"

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
      .reply("Ce salon recevra désormais les confessions à valider (Approuver/Refuser) avant leur publication.")
      .catch(() => {});
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
    const { channelId, validationChannelId } = confessStore.getConfig(etat.guildId);
    const salonPublic = guild?.channels.cache.get(channelId);
    if (!guild || !salonPublic?.isTextBased?.()) {
      return interaction.update({ content: "Le salon de confessions n'est plus configuré sur ce serveur — abandon.", components: [] });
    }

    const donnees = { guildId: etat.guildId, anonyme, texte: etat.texte, authorId: interaction.user.id, authorTag: interaction.user.tag };
    const salonValidation = validationChannelId ? guild.channels.cache.get(validationChannelId) : null;

    if (salonValidation?.isTextBased?.()) {
      const id = String(prochainIdValidation++);
      enAttenteValidation.set(id, donnees);
      await salonValidation.send(buildValidationCard(id, donnees)).catch(() => {});
      return interaction.update({ content: "C'est envoyé ! Ta confession est en attente de validation par le staff.", components: [] });
    }

    await publierConfession(guild, salonPublic, donnees);
    return interaction.update({ content: "C'est envoyé ! Ta confession vient d'être publiée.", components: [] });
  }

  if (action === "valider") {
    if (!can(interaction.member, "channels.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour ça.", flags: MessageFlags.Ephemeral });
    }
    const [choix, id] = reste;
    const donnees = enAttenteValidation.get(id);
    if (!donnees) {
      return interaction.update({ content: "Cette confession n'est plus en attente (déjà traitée, ou le bot a redémarré entre-temps).", components: [] });
    }
    enAttenteValidation.delete(id);

    const guild = interaction.client.guilds.cache.get(donnees.guildId);
    const { channelId } = confessStore.getConfig(donnees.guildId);
    const salonPublic = guild?.channels.cache.get(channelId);

    if (choix === "approuve" && salonPublic?.isTextBased?.()) {
      await publierConfession(guild, salonPublic, donnees);
      await interaction.update({ content: `✅ Confession approuvée par ${interaction.user.tag} et publiée.`, embeds: interaction.message.embeds, components: [] });
    } else {
      await interaction.update({ content: `❌ Confession refusée par ${interaction.user.tag}.`, embeds: interaction.message.embeds, components: [] });
    }

    const auteur = await interaction.client.users.fetch(donnees.authorId).catch(() => null);
    if (auteur) {
      await auteur
        .send(choix === "approuve" ? "Ta confession a été validée et publiée !" : "Ta confession n'a pas été validée par le staff.")
        .catch(() => {});
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
