const { EmbedBuilder } = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const confessStore = require("./confessStore");
const { can } = require("./permissions/engine");
const { createRateLimiter } = require("./rateLimiter");

// !!confess — confessions anonymes, demande explicite inspirée d'un salon
// #confess montré en capture (cartes colorées "envoie-moi des messages
// anonymes !"). Volontairement sur le préfixe "!!" déjà utilisé par
// utils/personalProtection.js — même mécanique de lecture du préfixe, un mot
// différent après ("confess" au lieu de "panel"), donc les deux coexistent
// sans jamais se marcher dessus.
//
// L'ANONYMAT est tout l'intérêt de la fonctionnalité : le message d'origine
// est supprimé AVANT même de savoir si l'envoi va réussir (c'est lui qui
// identifie l'auteur), et toute réponse au demandeur part en MP plutôt que
// dans le salon — une confirmation publique juste après une suppression
// laisserait deviner qui vient d'écrire quoi.

const COULEUR = 0xff5e8a; // rose/orangé, dans l'esprit des cartes de la capture fournie
const LONGUEUR_MAX = 4000; // marge sous la limite réelle de description d'embed (4096)

// Une confession par personne toutes les 20s : assez large pour un usage
// normal, assez court pour empêcher de noyer le salon en spammant la commande.
const limiteur = createRateLimiter(1, 20_000);

async function handleConfessTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const reste = content.slice(PREFIX.length).trim();
  const [mot, ...suite] = reste.split(/\s+/);
  if ((mot || "").toLowerCase() !== "confess") return; // mot inconnu sur ce préfixe : silence, comme "panel"

  if ((suite[0] || "").toLowerCase() === "setup") {
    if (!can(message.member, "channels.manage")) {
      return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
    }
    confessStore.setChannel(message.guild.id, message.channel.id);
    return message
      .reply(`Ce salon recevra désormais les confessions anonymes envoyées avec \`${PREFIX}confess <message>\`.`)
      .catch(() => {});
  }

  const texte = suite.join(" ").trim();

  // Supprimé EN PREMIER, avant toute validation : le message d'origine est
  // la seule chose qui relie ce texte à son auteur.
  await message.delete().catch(() => {});

  if (!texte) {
    return message.author
      .send(`Écris ton message juste après la commande, par exemple : \`${PREFIX}confess Ce que tu veux dire\`.`)
      .catch(() => {});
  }
  if (texte.length > LONGUEUR_MAX) {
    return message.author.send(`Ta confession est trop longue (max ${LONGUEUR_MAX} caractères) — raccourcis-la et retente.`).catch(() => {});
  }

  const { allowed, retryAfterMs } = limiteur.check(`${message.guild.id}:${message.author.id}`);
  if (!allowed) {
    const secondes = Math.ceil(retryAfterMs / 1000);
    return message.author.send(`Une confession à la fois — réessaie dans ${secondes}s.`).catch(() => {});
  }

  const { channelId } = confessStore.getConfig(message.guild.id);
  if (!channelId) {
    return message.author
      .send(`Aucun salon de confessions n'est configuré sur ce serveur — un modérateur doit d'abord taper \`${PREFIX}confess setup\` dans le salon voulu.`)
      .catch(() => {});
  }
  const salon = message.guild.channels.cache.get(channelId);
  if (!salon?.isTextBased?.()) {
    return message.author
      .send(`Le salon de confessions configuré n'existe plus — un modérateur doit relancer \`${PREFIX}confess setup\`.`)
      .catch(() => {});
  }

  const numero = confessStore.prochainNumero(message.guild.id);
  const embed = new EmbedBuilder().setColor(COULEUR).setTitle(`📩 Confession anonyme #${numero}`).setDescription(texte);

  const envoye = await salon.send({ embeds: [embed] }).catch(() => null);
  if (!envoye) {
    return message.author
      .send("Impossible d'envoyer ta confession — le bot n'a peut-être plus accès à ce salon.")
      .catch(() => {});
  }

  return message.author.send(`Ta confession a bien été envoyée anonymement dans <#${salon.id}>.`).catch(() => {});
}

module.exports = { handleConfessTextCommand };
