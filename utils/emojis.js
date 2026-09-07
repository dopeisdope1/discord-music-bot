// Emojis custom du serveur (Personnalisation > Emojis) — SOURCE UNIQUE de
// leurs identifiants Discord. Tout le reste du bot importe ce module plutôt
// que de recopier un <:nom:id> à la main : si un emoji est un jour
// re-téléversé (nouvel ID), un seul endroit à corriger.
//
// Format Discord : <:nom:id> pour un emoji statique, <a:nom:id> pour un
// animé (préfixe "a" obligatoire, sinon il s'affiche comme une image figée).
const EMOJI = {
  // Statuts (utils/statusEmbed.js, réutilisés partout ailleurs)
  SUCCESS: "<:yes:1546335865905619068>",
  ERROR: "<:no:1546335823002210334>",
  INFO: "<:Notification:1546336545836105783>",
  CHECK: "<:CheckMark:1546335757399097444>",
  CROSS: "<:crossemoji:1546336622835146773>",

  // Modération
  BAN: "<:Hammer:1546334520188473354>",
  KICK: "<:hammer:1546334634453893211>",
  MUTE: "<:server_mute:1546334792088551455>",
  UNMUTE: "<:self_mute:1546334739475079301>",
  DELETE: "<:r_IconDelete:1546337639806799922>",
  PENCIL: "<:Pencil:1546336095803805820>",

  // Rangs / rôles
  OWNER: "<:owner:1546335371900756009>",
  CROWN: "<:Crown:1546335449046323230>",
  STAFF: "<:b_DiscordStaff:1546335010389233826>",
  STAFF_AWAY: "<:n_zzzzzzzzstaff:1546335055314690142>",

  // Serveur / communauté
  TICKET: "<:ticket:1546335157823479850>",
  LOCK: "<:Lock:1546335998529642628>",
  MAIL: "<:Mail:1546335926219833466>",
  RULES: "<:DiscordRules:1546335623462391868>",
  MEMBERS: "<:memberserver:1546336225433223221>",
  ONLINE: "<a:StatusOnline:1546336280021831680>",
  VOICE: "<:voice_channel:1546336345008504973>",
  SCREENSHARE: "<:screenshare_volume_max:1546336471693262869>",

  // Divers / navigation
  DISCORD: "<:b_Discord:1546337688435564576>",
  ARROW: "<:b_arrowj:1546337803007172718>",
  ARROW_GREEN: "<a:arrowgreen:1546337178706120784>",
  BOING: "<a:boing:1546337270196477992>",
};

module.exports = { EMOJI };
