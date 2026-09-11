const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const confessStore = require("./confessStore");
const { can } = require("./permissions/engine");

// !!confess — confessions anonymes, REPRODUISANT EXACTEMENT le déroulé montré
// en capture par l'utilisateur (carte "Confesse-toi", bouton "Je souhaite
// participer" -> question garçon/fille -> message envoyé en DM au bot ->
// choix de rester anonyme ou non -> attente de validation -> publication, la
// communauté votant ensuite). Une première version acceptait le message
// directement dans la commande texte ("!!confess <message>") — explicitement
// refusée ("c'est pas ce que je veux vraiment") : ce fichier la remplace
// entièrement par le vrai déroulé à étapes.
//
// Toujours sur le préfixe "!!" déjà utilisé par utils/personalProtection.js —
// même mécanique de lecture du préfixe, un mot différent après ("confess" au
// lieu de "panel"), donc les deux coexistent sans jamais se marcher dessus.

const CUSTOM_ID = "confess";
const COULEUR = 0xff5e8a; // rose/orangé, dans l'esprit de la capture fournie
const LONGUEUR_MAX = 4000; // marge sous la limite réelle de description d'embed (4096)

// État des flux en cours, EN MÉMOIRE (comme utils/messageOwner.js) : un
// redémarrage du bot en plein milieu d'une confession force juste à
// recommencer, ça n'a pas besoin de survivre sur disque.
// userId -> { guildId, etape: "genre"|"attente_dm"|"anonymat", genre?, texte? }
const enCours = new Map();

// Confessions envoyées, en attente d'un clic Approuver/Refuser dans le salon
// de validation. id (compteur local) -> { guildId, genre, anonyme, texte, authorId, authorTag }
const enAttenteValidation = new Map();
let prochainIdValidation = 1;

function buildConfessCard() {
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle("Confesse-toi 💌")
    .setDescription(
      [
        "Tu as quelque chose à avouer ? C'est ici que ça se passe.",
        "",
        "Envoie ton **message anonyme**, laisse la communauté voter et découvre ce qu'elle pense. Tu choisis si tu restes **anonyme** — le reste, c'est le public qui décide. Tout se passe via le bot.",
        "",
        "**Comment participer ?**",
        "> **1.** Clique sur le bouton ci-dessous",
        "> **2.** Indique si tu es un garçon ou une fille",
        "> **3.** Envoie ton message anonyme en DM au bot",
        "> **4.** Choisis si tu veux rester anonyme ou non",
        "> **5.** Attends la validation — puis la communauté réagit !",
        "",
        "💞 En participant tu confirmes avoir l'âge légal requis et acceptes que ton contenu soit visible par les membres du serveur.",
      ].join("\n")
    );
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:start`).setLabel("Je souhaite participer").setStyle(ButtonStyle.Primary).setEmoji("➡️"),
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:notif`).setLabel("Gérer les notifications").setStyle(ButtonStyle.Secondary).setEmoji("🔔")
  );
  return { embeds: [embed], components: [boutons] };
}

function buildValidationCard(id, donnees) {
  const genreLabel = donnees.genre === "fille" ? "Fille" : "Garçon";
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle("📋 Confession en attente de validation")
    .setDescription(donnees.texte)
    .addFields(
      { name: "Auteur", value: donnees.authorTag, inline: true },
      { name: "Genre indiqué", value: genreLabel, inline: true },
      { name: "Reste anonyme ?", value: donnees.anonyme ? "Oui" : "Non — pseudo affiché", inline: true }
    );
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:valider:approuve:${id}`).setLabel("Approuver").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:valider:refuse:${id}`).setLabel("Refuser").setStyle(ButtonStyle.Danger)
  );
  return { embeds: [embed], components: [boutons] };
}

/** Publie la confession dans le salon public, avec les réactions de vote 👍/👎 — "la communauté vote". */
async function publierConfession(guild, salon, donnees) {
  const numero = confessStore.prochainNumero(guild.id);
  const genreLabel = donnees.genre === "fille" ? "🙋‍♀️ Une fille" : "🙋‍♂️ Un garçon";
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle(`💌 Confession #${numero}`)
    .setDescription(donnees.texte)
    .setFooter({ text: donnees.anonyme ? `${genreLabel} anonyme` : `${genreLabel} — ${donnees.authorTag}` });

  const envoye = await salon.send({ embeds: [embed] }).catch(() => null);
  if (!envoye) return null;
  await envoye.react("👍").catch(() => {});
  await envoye.react("👎").catch(() => {});

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
 * parcours se fait par boutons et par MP.
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

/**
 * Étape 3 du parcours : le message privé envoyé au bot, une fois qu'on
 * attend justement ça pour cette personne. À appeler pour TOUT message reçu
 * en MP (index.js) — ne fait rien pour qui n'a pas cliqué "Je souhaite
 * participer" avant.
 */
async function handleConfessDM(client, message) {
  if (message.author.bot || message.guild) return;
  const etat = enCours.get(message.author.id);
  if (!etat || etat.etape !== "attente_dm") return;

  const texte = message.content.trim();
  if (!texte) return message.reply("Ton message est vide — réessaie.").catch(() => {});
  if (texte.length > LONGUEUR_MAX) {
    return message.reply(`Message trop long (max ${LONGUEUR_MAX} caractères) — raccourcis-le et renvoie-le.`).catch(() => {});
  }

  etat.texte = texte;
  etat.etape = "anonymat";
  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:anon:oui`).setLabel("Rester anonyme").setStyle(ButtonStyle.Secondary).setEmoji("🕶️"),
    new ButtonBuilder().setCustomId(`${CUSTOM_ID}:anon:non`).setLabel("Afficher mon pseudo").setStyle(ButtonStyle.Secondary).setEmoji("🙈")
  );
  return message.reply({ content: "Veux-tu rester anonyme, ou qu'on affiche ton pseudo à côté de ta confession ?", components: [boutons] }).catch(() => {});
}

async function handleConfessInteraction(interaction) {
  const [, action, ...reste] = interaction.customId.split(":");

  if (action === "start") {
    if (enCours.has(interaction.user.id)) {
      return interaction.reply({ content: "Tu as déjà une confession en cours — regarde tes messages privés.", flags: MessageFlags.Ephemeral });
    }
    enCours.set(interaction.user.id, { guildId: interaction.guild.id, etape: "genre" });
    const boutons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:genre:garcon`).setLabel("Garçon").setStyle(ButtonStyle.Secondary).setEmoji("🙋‍♂️"),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:genre:fille`).setLabel("Fille").setStyle(ButtonStyle.Secondary).setEmoji("🙋‍♀️")
    );
    return interaction.reply({ content: "Es-tu un garçon ou une fille ?", components: [boutons], flags: MessageFlags.Ephemeral });
  }

  if (action === "genre") {
    const etat = enCours.get(interaction.user.id);
    if (!etat || etat.etape !== "genre") {
      return interaction.reply({ content: 'Cette étape a expiré — reclique sur "Je souhaite participer".', flags: MessageFlags.Ephemeral });
    }
    etat.genre = reste[0]; // "garcon" | "fille"
    etat.etape = "attente_dm";
    await interaction.update({ content: "Envoie-moi maintenant ton message anonyme, ICI en message privé.", components: [] });
    return interaction.user.send("Je t'écoute — envoie-moi le message que tu veux confesser anonymement.").catch(() => {
      // Le MP peut échouer si les MP sont fermés depuis ce serveur : l'étape
      // reste ouverte, la personne peut quand même répondre directement dans
      // le fil de MP existant avec le bot si elle en a un.
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

    const donnees = { guildId: etat.guildId, genre: etat.genre, anonyme, texte: etat.texte, authorId: interaction.user.id, authorTag: interaction.user.tag };
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

module.exports = { handleConfessTextCommand, handleConfessDM, handleConfessInteraction, CUSTOM_ID };
