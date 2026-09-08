const { DateTime } = require("luxon");
const boostProgress = require("./boostProgress");
const profileCard = require("./profileCard");

// &boost et &profil.
//
// TOUT ce qui est affiché vient de l'API : `member.premiumSince` pour la date
// de boost, `user.createdAt` pour la création du compte, l'avatar réel du
// membre. Rien n'est estimé ni complété.
//
// Il n'y a volontairement PAS de commande &nitro : la date d'activation du
// Nitro n'existe sur aucun objet accessible à un bot (ni `User`, ni
// `GuildMember`). Elle ne vit que sur `/users/{id}/profile`, un point d'entrée
// réservé aux tokens de compte. L'afficher supposerait donc de faire tourner
// un compte utilisateur comme un bot — ce que le bot ne fait pas.

/**
 * La cible d'une commande : mention, identifiant brut, ou l'auteur à défaut.
 * Aucun sélecteur de membre — les cibles se donnent par mention ou par ID.
 * @returns {Promise<import('discord.js').GuildMember|null>} `null` quand un
 *   identifiant est fourni mais ne correspond à personne sur le serveur.
 */
async function cibleDe(message, args) {
  const mentionne = message.mentions?.members?.first?.();
  if (mentionne) return mentionne;
  const brut = (args[0] || "").replace(/[<@!>]/g, "").trim();
  if (!brut) return message.member;
  if (!/^\d{5,25}$/.test(brut)) return null;
  try {
    return await message.guild.members.fetch(brut);
  } catch {
    return null;
  }
}

/** Les mêmes formateurs pour les deux cartes, l'instant « maintenant » figé. */
function formateurs(maintenant) {
  return {
    relatif: (d) => boostProgress.relatif(d, maintenant),
    dateCourte: (d) => boostProgress.dateCourte(d),
    dateLongue: (d) => boostProgress.dateLongue(d),
  };
}

/**
 * Ce qui sera DESSINÉ sur la carte &boost, en données. Exporté pour que les
 * tests vérifient le contenu sans avoir à lire une image — même approche que
 * utils/helpPanel.js::buildHelpSpec.
 */
function specBoost(member, maintenant = Date.now()) {
  return {
    nom: profileCard.nomDe(member),
    progression: boostProgress.progression(member?.premiumSince ?? null, maintenant),
    ...formateurs(maintenant),
  };
}

/** Idem pour &profil. */
function specProfil(member, maintenant = Date.now()) {
  const user = member?.user || member;
  // Les serveurs en commun se limitent à ceux que le BOT voit : il ne connaît
  // pas les autres serveurs de la personne, et prétendre le contraire serait
  // inventer une donnée.
  const serveurs = [...(member?.client?.guilds?.cache?.values?.() || [])]
    .filter((g) => g.members?.cache?.has?.(user?.id))
    .map((g) => g.name);
  return {
    nom: profileCard.nomDe(member),
    mention: `@${user?.username || user?.tag || member?.id || "inconnu"}`,
    identifiant: String(user?.id || member?.id || "inconnu"),
    creation: user?.createdAt ? DateTime.fromJSDate(user.createdAt).setLocale("fr").toFormat("dd/LL/yyyy 'à' HH'h'mm") : "inconnue",
    progression: boostProgress.progression(member?.premiumSince ?? null, maintenant),
    serveurs,
    ...formateurs(maintenant),
  };
}

/**
 * Envoie une carte, avec le lien de téléchargement de la photo de profil en
 * bouton : une image ne peut pas porter de lien cliquable, et « Pfp :
 * Download » n'aurait servi à rien dessiné.
 */
async function envoyer(message, spec, dessiner, nomFichier, avatarURL) {
  const png = dessiner(spec);
  const payload = { files: [profileCard.enFichier(png, nomFichier)] };
  if (avatarURL) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
    payload.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Télécharger la photo de profil").setURL(avatarURL)
      ),
    ];
  }
  return message.reply(payload).catch(async (err) => {
    console.error("[profileCommands] envoi refusé :", err);
    return message.reply("Impossible d'envoyer la carte ici — il manque sans doute le droit « Joindre des fichiers ».").catch(() => {});
  });
}

async function boost(client, message, args) {
  const member = await cibleDe(message, args);
  if (!member) return message.reply("Aucun membre ne correspond à cet identifiant sur ce serveur.").catch(() => {});
  const spec = specBoost(member);
  spec.avatar = await profileCard.prechargerAvatar(profileCard.avatarDe(member));
  return envoyer(message, spec, profileCard.dessinerBoost, "boost.png");
}

async function profil(client, message, args) {
  const member = await cibleDe(message, args);
  if (!member) return message.reply("Aucun membre ne correspond à cet identifiant sur ce serveur.").catch(() => {});
  const url = profileCard.avatarDe(member);
  const spec = specProfil(member);
  spec.avatar = await profileCard.prechargerAvatar(url);
  return envoyer(message, spec, profileCard.dessinerProfil, "profil.png", url);
}

module.exports = { boost, profil, specBoost, specProfil, cibleDe };
