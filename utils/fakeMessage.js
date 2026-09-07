const { Collection, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require("discord.js");

// Interactions dont la réponse doit REMPLACER le message d'origine au lieu
// d'ouvrir un message éphémère à côté. Posé par utils/commandForms.js juste
// avant de lancer la commande : le résultat prend alors la place de la carte
// de formulaire — c'est le même geste, il mérite un seul message.
// Un WeakSet plutôt qu'un champ ajouté sur l'interaction : rien n'est greffé
// sur un objet de discord.js, et l'entrée disparaît avec l'interaction.
const A_REMPLACER = new WeakSet();
const DEJA_REMPLACE = new WeakSet();

function remplacerParLaReponse(interaction) {
  A_REMPLACER.add(interaction);
}
/** Le message d'origine a-t-il déjà été remplacé par une réponse ? */
function aEteRemplace(interaction) {
  return DEJA_REMPLACE.has(interaction);
}

/**
 * Une carte d'action est un simple PNG joint. Pour remplacer un message
 * Components V2 — la carte de formulaire en est un — il faut la présenter
 * elle-même en Components V2 : sur un tel message tout l'affichage passe par
 * des composants, une pièce jointe seule ne s'y afficherait pas.
 */
function enConteneurV2(payload) {
  if (!payload?.files?.length || payload.components?.length) return payload;
  const nom = payload.files[0].name;
  const container = new ContainerBuilder()
    .setAccentColor(0x2c2f5c)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${nom}`)));
  return { ...payload, flags: MessageFlags.IsComponentsV2, components: [container] };
}

// Adaptateur UNIQUE interaction -> "message" pour tout le bot : &panel
// (utils/configPanel.js) et les cartes de formulaire (utils/commandForms.js)
// appellent toutes deux les VRAIS handlers de commande texte (kick, ban,
// addrole, roleAdmin...) à travers cette même fonction, jamais une seconde
// implémentation de la logique métier. Extrait de utils/commandForms.js
// (refonte du panel) — comportement inchangé, seulement déplacé pour être
// partagé au lieu d'être dupliqué localement dans configPanel.js
// (`messageFromInteraction`, qui ne peuplait aucune mention).
/**
 * @param {import('discord.js').Interaction} interaction
 * @param {{ channel?, channels?, user?, role?, roles?, text?: string }} [opts]
 */
function fakeMessage(interaction, { channel, channels, user, role, roles: roleList, text = "" } = {}) {
  const users = new Collection();
  const members = new Collection();
  const roles = new Collection();
  const channelsColl = new Collection();
  if (user) {
    users.set(user.id, user.user || user);
    if (user.roles) members.set(user.id, user); // un GuildMember complet (a .roles.cache) alimente aussi mentions.members
  }
  if (role) roles.set(role.id, role);
  for (const r of roleList || []) roles.set(r.id, r);
  for (const c of channels || []) channelsColl.set(c.id, c); // ordre d'insertion préservé, important pour &voicemove (from -> to)

  return {
    author: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    channel: channel || interaction.channel,
    content: text,
    attachments: { first: () => null },
    mentions: { users, members, roles, channels: channelsColl, everyone: false },
    // Combiné en OU avec les flags déjà posés par le payload (ex :
    // MessageFlags.IsComponentsV2) — un simple écrasement perdrait ce bit sur
    // toute réponse Components V2 (ban_member/softban_member, entre autres),
    // que Discord refuserait alors puisque `components` contient des
    // builders V2 sans le flag qui les autorise.
    // L'échec était avalé en silence (`.catch(() => {})`) : quand une réponse
    // ne partait pas — pièce jointe refusée, interaction expirée — rien ne
    // l'indiquait nulle part, ni à l'utilisateur ni dans les logs, alors que
    // l'action avait bien eu lieu. On journalise donc le motif.
    reply: async (payload) => {
      // Première réponse d'une commande lancée depuis une carte de formulaire :
      // elle REMPLACE la carte au lieu d'ouvrir un message à côté. Les
      // réponses suivantes (une commande peut en envoyer plusieurs) repartent
      // en éphémère, pour ne pas écraser le résultat déjà affiché.
      if (A_REMPLACER.has(interaction) && !DEJA_REMPLACE.has(interaction)) {
        DEJA_REMPLACE.add(interaction);
        try {
          return await interaction.editReply({ ...enConteneurV2(payload), attachments: [] });
        } catch (err) {
          console.error(`[fakeMessage] remplacement impossible, repli en éphémère : ${err.message}`);
        }
      }
      return interaction
        .followUp({ ...payload, flags: (payload.flags || 0) | MessageFlags.Ephemeral })
        .catch((err) => console.error(`[fakeMessage] réponse non envoyée : ${err.message}`));
    },
  };
}

module.exports = { fakeMessage, remplacerParLaReponse, aEteRemplace };
