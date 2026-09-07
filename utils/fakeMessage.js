const { Collection, MessageFlags } = require("discord.js");

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
    reply: (payload) =>
      interaction
        .followUp({ ...payload, flags: (payload.flags || 0) | MessageFlags.Ephemeral })
        .catch((err) => console.error(`[fakeMessage] réponse non envoyée : ${err.message}`)),
  };
}

module.exports = { fakeMessage };
