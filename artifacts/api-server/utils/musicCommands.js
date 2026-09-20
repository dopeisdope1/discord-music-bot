const { buildStatusEmbed } = require("./statusEmbed");
const { getPrefixes } = require("./prefixStore");
const commandRouting = require("./commandRouting");
const accessStore = require("./accessStore");
const { can } = require("./permissions/engine");
const { channelHandlers } = require("./channelCommands");
const helpNavigator = require("./helpNavigator");
const gradeCardPanel = require("./gradeCardPanel");
const emojiPanel = require("./emojiPanel");
const { buildConfigPanel, hasAnyPanelAccess } = require("./configPanel");
const palierPanel = require("./palierPanel");
const { publicHandlers } = require("./publicCommands");
const { handleBanAll } = require("./banAll");
const { handleBan, handleUnban } = require("./banPanel");
const banInfoCard = require("./banInfoCard");
const { moderationHandlers } = require("./moderationCommands");
const { automodHandlers } = require("./automodCommands");
const { botProfileHandlers } = require("./botProfileCommands");
const moderationExtra = require("./moderationExtra");
const serverExtra = require("./serverExtra");
const commandForms = require("./commandForms");
const familyHelp = require("./familyHelp");
const customCommands = require("./customCommands");
const messageOwner = require("./messageOwner");
const { createRateLimiter } = require("./rateLimiter");
const counters = require("./counters");
const permsCommands = require("./permsCommands");
const { utilityHandlers } = require("./utilityCommands");
const { logHandlers } = require("./logCommands");
const { guardHandlers } = require("./guardCommands");
const { configHandlers } = require("./configCommands");
const serverAdmin = require("./serverAdminCommands");
const { backup } = require("./serverBackup");
const { setupTickets, claimTicket, addTicketMember, removeTicketMember, renameTicket, closeTicketCommand } = require("./tickets");
const ticketStore = require("./ticketStore");
const { createPoll } = require("./polls");
const { startGiveaway, rerollGiveaway, endGiveaway } = require("./giveaways");
const { autoroleHandlers } = require("./autoroleCommands");
const { setupVerification } = require("./verification");
const statusDiagnostic = require("./statusDiagnostic");
const { securityScan } = require("./securityScan");
const levels = require("./levels");
const rankLadder = require("./rankLadderCommands");
const zinkillerCommands = require("./zinkillerCommands");
const gradeMuteCommands = require("./gradeMuteCommands");

// Commandes dont la reponse est une IMAGE dessinee (utils/dashboardImage.js).
// Ce sont les seules a etre limitees en frequence : elles sont accessibles
// sans droit particulier, et chaque appel mobilise le moteur de rendu.
// &help n'en fait plus partie depuis son passage en texte pur (pas de dessin
// a limiter).
const COMMANDES_DESSINEES = new Set(["panel"]);
// Genereux a dessein : personne ne tape `&help` six fois en trente secondes
// sans le faire expres. Le but est d'arreter une boucle, pas de gener
// quelqu'un qui navigue.
const limiteurDessin = createRateLimiter(6, 30_000);

// Commandes sur le préfixe "&" (gestion). Ce préfixe est aussi celui du
// CrowBot présent sur le serveur : le bot reste donc MUET sur tout ce qui
// n'est pas listé ici, pour ne jamais répondre à la place de l'autre.
/** N'exécute `handler` que si la personne a la portée demandée, sinon rien. */
function requireScope(scope, handler) {
  return async (client, message, args) => {
    if (!accessStore.isAllowed(scope, message.author.id)) return;
    return handler(client, message, args);
  };
}

/**
 * Même chose via le moteur de permissions central (utils/permissions/engine.js) :
 * un pont de rétrocompatibilité y garde l'ancienne portée "salon" valide
 * pour "channels.lock"/"channels.manage", donc migrer ces commandes ici ne
 * casse aucun accès déjà accordé, tout en les rendant octroyables par rôle
 * depuis le panel (section 6/7 du cahier des charges).
 */
function requirePermission(key, handler) {
  return async (client, message, args) => {
    if (!can(message.member, key)) return;
    return handler(client, message, args);
  };
}

/**
 * Poste un tableau de bord (&help, &panel), et retombe sur sa version TEXTE
 * si Discord refuse le message.
 *
 * Le cas qui arrive vraiment : le bot n'a pas la permission « Joindre des
 * fichiers » dans le salon. Le tableau de bord est une IMAGE jointe et rien
 * d'autre — sans ce garde-fou, l'exception remonte jusqu'au filet de
 * index.js et la personne ne reçoit qu'un « Une erreur est survenue », alors
 * que tout le contenu de &help était disponible en texte. Même principe que
 * utils/actionCard.js::repondreAvecCarte pour les cartes de sanction.
 * @param {import('discord.js').Message} message
 * @param {(sansImage: boolean) => object} construire
 */
async function repondreAvecTableauDeBord(message, construire) {
  // Construit AVANT le try : seul un ENVOI refusé doit déclencher le repli.
  // Une erreur de construction, elle, doit remonter telle quelle au filet de
  // index.js — la rejouer en texte ne la corrigerait pas et la ferait passer
  // pour un problème de permission dans les logs.
  const avecImage = construire(false);
  try {
    // `repondreEtRetenir` : le panneau appartient a qui l'a ouvert, et lui
    // seul peut cliquer dessus (voir utils/messageOwner.js).
    return await messageOwner.repondreEtRetenir(message, avecImage);
  } catch (err) {
    console.error(`[dashboard] envoi de l'image refusé (permission « Joindre des fichiers » ?) : ${err.message}`);
    return messageOwner.repondreEtRetenir(message, construire(true));
  }
}

const modHandlers = {
  // Ouvert à tout le monde, mais le contenu est filtré sur les droits réels
  // de la personne (voir utils/helpPanel.js). Un seul message, navigable via
  // le menu "Choisir un palier" (utils/helpNavigator.js) — jamais plusieurs
  // messages postés d'affilée, même avec 150+ commandes configurables.
  async help(client, message) {
    return helpNavigator.repondreAvecAide("gestion", message);
  },

  // Commandes publiques d'affichage : aucune autorisation requise, elles ne
  // font que lire des informations.
  pic: publicHandlers.pic,
  banner: publicHandlers.banner,
  server: publicHandlers.server,
  snipe: publicHandlers.snipe,

  async panel(client, message) {
    if (!hasAnyPanelAccess(message.member)) return;
    await repondreAvecTableauDeBord(message, (sansImage) =>
      buildConfigPanel(message.guild, "home", message.member, {}, { sansImage })
    );
  },

  // Raccourci direct vers les paliers de permissions (voir
  // utils/palierPanel.js) : une ligne par palier, Supprimer/Ajouter/Renommer
  // juste dessous — sans passer par accueil -> menu -> sous-menu comme
  // &panel. Public en lecture (comme &helpall) : les boutons de gestion ne
  // s'affichent que pour qui a le droit de s'en servir.
  p: palierPanel.handlePalierTextCommand,

  // Ces commandes vérifient leurs propres droits à l'intérieur (moteur de
  // permissions central, voir utils/permissions/engine.js) : banall inclut
  // le propriétaire du serveur, ce que requireScope ne sait pas exprimer, et
  // toutes restent muettes pour les non-autorisés plutôt que de répondre à
  // la place du CrowBot sur ce préfixe partagé.
  banall: handleBanAll,
  ban: handleBan,
  unban: handleUnban,
  baninfo: async (client, message, args) => {
    if (!can(message.member, "moderation.ban")) return;
    const mention = args[0]?.match(/^<@!?(\d{15,25})>$/);
    const idArg = args[0]?.match(/^\d{15,25}$/);
    const targetId = mention?.[1] || idArg?.[0];
    const erreur = (texte) => message.reply({ embeds: [buildStatusEmbed("error", texte)] });
    if (!targetId) return erreur("Indique un membre (mention ou identifiant) : `baninfo @membre`.");
    const target = await message.guild.members.fetch(targetId).catch(() => null);
    if (!target) return erreur("Ce membre n'est pas sur le serveur.");
    return banInfoCard.repondreAvecBanInfo(message, target);
  },
  zinkiller: zinkillerCommands.zinkiller,
  unzinkiller: zinkillerCommands.unzinkiller,
  zinkillerlist: zinkillerCommands.zinkillerlist,
  bmute: gradeMuteCommands.bmute,
  bunmute: gradeMuteCommands.bunmute,
  bmutelist: gradeMuteCommands.bmutelist,
  bmuteresetall: gradeMuteCommands.bmuteresetall,

  renew: requirePermission("channels.manage", channelHandlers.renew),
  hide: requirePermission("channels.manage", channelHandlers.hide),
  unhide: requirePermission("channels.manage", channelHandlers.unhide),
  lock: requirePermission("channels.lock", channelHandlers.lock),
  unlock: requirePermission("channels.lock", channelHandlers.unlock),

  // Nouvelles commandes de modération (refonte permissions/rôles/logs/panel) —
  // chacune vérifie sa propre clé de permission via utils/permissions/engine.js.
  kick: moderationHandlers.kick,
  softban: moderationHandlers.softban,
  timeout: moderationHandlers.timeout,
  untimeout: moderationHandlers.untimeout,
  slowmode: moderationHandlers.slowmode,
  nick: moderationHandlers.nick,
  resetnick: moderationHandlers.resetnick,
  // "role create/delete/rename/color/admin" gère le rôle lui-même (voir
  // utils/serverAdminCommands.js) ; l'appartenance d'un membre à un rôle se
  // fait via "&addrole"/"&delrole" (utils/moderationCommands.js), distincts.
  // Sans sous-commande reconnue, "role @rôle" affiche sa fiche d'info
  // (utils/utilityCommands.js::roleInfo, server.info.view) — un mot qui
  // n'est ni une sous-commande ni un rôle valide échoue simplement côté
  // roleInfo, comme n'importe quel argument invalide.
  role: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (serverAdmin.ROLE_ADMIN_SUBCOMMANDS.has(sub)) return serverAdmin.roleAdmin(client, message, args);
    return utilityHandlers.roleInfo(client, message, args);
  },
  addrole: moderationHandlers.addrole,
  delrole: moderationHandlers.delrole,
  limitrole: serverAdmin.limitRole,
  promote: rankLadder.promote,
  demote: rankLadder.demote,
  gradeladder: rankLadder.gradeLadder,
  // "&emoji" — panel de personnalisation des emojis de l'aide. La commande
  // qui récupère l'image d'un emoji existant a été déplacée sur "&emojiinfo"
  // pour libérer ce mot (deux commandes différentes n'ont jamais le même mot
  // sur le même préfixe).
  emoji: emojiPanel.handleEmojiTextCommand,
  grade: async (client, message, args) => {
    if (!can(message.member, "members.rank.manage")) return;
    const mention = args[0]?.match(/^<@!?(\d{15,25})>$/);
    const idArg = args[0]?.match(/^\d{15,25}$/);
    const targetId = mention?.[1] || idArg?.[0];
    const erreur = (texte) => message.reply({ embeds: [buildStatusEmbed("error", texte)] });
    if (!targetId) return erreur("Indique un membre (mention ou identifiant) : `grade @membre`.");
    const target = await message.guild.members.fetch(targetId).catch(() => null);
    if (!target) return erreur("Ce membre n'est pas sur le serveur.");
    return gradeCardPanel.repondreAvecGradeCard(message, target);
  },
  absence: utilityHandlers.absence,
  staff: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "list") return utilityHandlers.staffList(client, message);
    // "check" reste accepté mais n'est plus exigé — "&staff @membre" marche
    // directement (staffCheck lit la mention, jamais les mots de `args`).
    return utilityHandlers.staffCheck(client, message, sub === "check" ? args.slice(1) : args);
  },
  modlogs: moderationHandlers.modlogs,
  // "clear sanctions"/"clear all sanctions" gèrent l'historique d'un membre
  // (utils/moderationExtra.js) ; tout le reste (y compris un mot-clé non
  // reconnu, ex "clear owners") reste le nettoyage de messages habituel —
  // jamais l'inverse, pour ne pas re-ouvrir la collision corrigée sur &clear.
  clear: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "sanctions") return moderationExtra.clearSanctions(client, message, args.slice(1));
    if (sub === "all" && (args[1] || "").toLowerCase() === "sanctions") return moderationExtra.clearAllSanctions(client, message);
    if (sub === "perms") return configHandlers.clearPerms(client, message, args.slice(1));
    if (sub === "limit") return configHandlers.clearLimit(client, message, args.slice(1));
    return moderationHandlers.clear(client, message, args);
  },
  purge: moderationHandlers.purge,
  lockdown: moderationHandlers.lockdown,
  panic: moderationHandlers.panic,
  unlockdown: moderationHandlers.unlockdown,

  // Administration du serveur (rôles/salons créés de zéro, owners, whitelist,
  // liste des bots, dero automatique) — voir utils/serverAdminCommands.js.
  // Même principe que "role" ci-dessus : sans sous-commande reconnue,
  // "channel [#salon]" affiche sa fiche d'info (server.info.view) au lieu
  // du message d'erreur générique de channelAdmin.
  channel: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (serverAdmin.CHANNEL_ADMIN_SUBCOMMANDS.has(sub)) return serverAdmin.channelAdmin(client, message, args);
    return utilityHandlers.channelInfo(client, message, args);
  },
  owners: serverAdmin.owners,
  access: serverAdmin.access,
  owner: serverAdmin.ownerModeration,
  sys: serverAdmin.sysAdd,
  unsys: serverAdmin.sysRemove,
  rank: levels.rank,
  leaderboard: levels.leaderboard,
  levels: levels.levelsToggle,
  whitelist: serverAdmin.whitelist,
  allbots: serverAdmin.allbots,
  dero: serverAdmin.dero,
  antinuke: serverAdmin.antinuke,
  backup,
  vc: utilityHandlers.vc,
  stats: (client, message, args) => {
    if ((args[0] || "").toLowerCase() === "history") return utilityHandlers.statsHistory(client, message, args.slice(1));
    return utilityHandlers.stats(client, message, args);
  },
  status: statusDiagnostic.status,
  security: (client, message, args) => {
    if ((args[0] || "").toLowerCase() === "scan") return securityScan(client, message, args.slice(1));
  },

  // Tickets/sondages/giveaways — voir utils/tickets.js, utils/polls.js,
  // utils/giveaways.js.
  ticket: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "setup") return setupTickets(client, message, args.slice(1));
    if (sub === "settings") return configHandlers.ticketSettings(client, message, args.slice(1));
  },
  // &claim/&add/&remove/&rename/&close — SANS "ticket" devant, demande
  // explicite pour ne pas avoir à le retaper à chaque fois DANS un ticket déjà
  // ouvert (donc pas de "ticket claim" en parallèle : un seul chemin pour
  // chacune, pas deux syntaxes à maintenir pour la même chose). Un mot aussi
  // générique que "close"/"add"/"rename" ne doit rien faire ailleurs (silence,
  // comme une commande inconnue sur ce préfixe partagé avec le CrowBot), donc
  // chacun vérifie d'ABORD que le salon est un ticket suivi avant même de
  // regarder les droits — sinon &add ou &close tapé dans un salon quelconque
  // répondrait une erreur qui n'a pas de sens en dehors d'un ticket.
  claim: (client, message) => {
    if (!ticketStore.getTicketInfo(message.channel.id)) return;
    return claimTicket(client, message);
  },
  add: (client, message, args) => {
    if (!ticketStore.getTicketInfo(message.channel.id)) return;
    return addTicketMember(client, message, args);
  },
  // PAS de "remove:" ici : "&remove" existe déjà plus bas (remove activity,
  // rang sys) — voir juste avant "online/idle/dnd/invisible" où les deux sont
  // fusionnés en un seul handler, selon qu'on est dans un ticket ou non.
  rename: (client, message, args) => {
    if (!ticketStore.getTicketInfo(message.channel.id)) return;
    return renameTicket(client, message, args);
  },
  close: (client, message, args) => {
    if (!ticketStore.getTicketInfo(message.channel.id)) return;
    return closeTicketCommand(client, message, args);
  },
  poll: createPoll,
  giveaway: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "start") return startGiveaway(client, message, args.slice(1));
    if (sub === "reroll") return rerollGiveaway(client, message, args.slice(1));
  },
  end: (client, message, args) => {
    if ((args[0] || "").toLowerCase() === "giveaway") return endGiveaway(client, message, args.slice(1));
  },

  // Publiques, sans vérification de droits — même famille que pic/banner/server.
  userinfo: moderationHandlers.userinfo,
  // Commandes personnalisees du serveur (utils/customCommands.js).
  addcmd: customCommands.customCommandHandlers.addcmd,
  delcmd: customCommands.customCommandHandlers.delcmd,
  listcmd: customCommands.customCommandHandlers.listcmd,
  // Compteurs de serveur (utils/counters.js).
  compteur: counters.compteur,
  // Alias stricts : la même fonction, pas une seconde version du même écran.
  // &avatar et &serverinfo avaient chacun leur propre implémentation, qui
  // affichait les mêmes informations autrement (et moins bien : &avatar ne
  // savait pas lire un ID brut). Elles ont été supprimées.
  avatar: publicHandlers.pic,
  serverinfo: publicHandlers.server,

  // Automod léger (anti-lien/anti-mass-mention/mots interdits) — voir
  // utils/automodCommands.js, permission "protection.automod" (même que
  // l'anti-spam, configurable aussi depuis &panel > Protection).
  prefix: configHandlers.prefix,
  join: (client, message, args) => {
    if ((args[0] || "").toLowerCase() === "settings") return configHandlers.joinSettings(client, message, args.slice(1));
  },
  leave: (client, message, args) => {
    if ((args[0] || "").toLowerCase() === "settings") return configHandlers.leaveSettings(client, message, args.slice(1));
  },
  autorole: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "add") return autoroleHandlers.add(client, message, args.slice(1));
    if (sub === "del") return autoroleHandlers.del(client, message, args.slice(1));
    if (sub === "list") return autoroleHandlers.list(client, message, args.slice(1));
  },
  verify: (client, message, args) => {
    if ((args[0] || "").toLowerCase() === "setup") return setupVerification(client, message, args.slice(1));
  },
  antispam: automodHandlers.antispam,
  spam: automodHandlers.spam,
  antilink: automodHandlers.antilink,
  link: automodHandlers.link,
  antimassmention: automodHandlers.antimassmention,
  badwords: automodHandlers.badwords,

  // Profil/présence du bot — voir utils/botProfileCommands.js, rang sys
  // uniquement (comme &owners/&sources/&allbots).
  // "set muterole" gère le rôle de mute (utils/moderationExtra.js) ; le
  // reste (name/pic/banner) reste le profil du bot (utils/botProfileCommands.js).
  set: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "muterole") return moderationExtra.setMuteRole(client, message, args.slice(1));
    if (sub === "perm") return configHandlers.setPerm(client, message, args.slice(1));
    return botProfileHandlers.set(client, message, args);
  },
  playto: botProfileHandlers.playto,
  listen: botProfileHandlers.listen,
  watch: botProfileHandlers.watch,
  compet: botProfileHandlers.compet,
  stream: botProfileHandlers.stream,
  // "&remove" fait double emploi volontairement : retirer un membre du
  // ticket courant s'il y en a un (raccourci sans "ticket" devant, demande
  // explicite), sinon "remove activity" comme avant — les deux ne se
  // recoupent jamais en pratique (retirer l'activité du bot depuis un salon
  // de ticket serait un accident, pas un usage réel).
  remove: (client, message, args) => {
    if (ticketStore.getTicketInfo(message.channel.id)) return removeTicketMember(client, message, args);
    return botProfileHandlers.remove(client, message, args);
  },
  online: botProfileHandlers.online,
  idle: botProfileHandlers.idle,
  dnd: botProfileHandlers.dnd,
  invisible: botProfileHandlers.invisible,

  // Mute par rôle (distinct du timeout natif), sanctions, tempban/banlist,
  // masquage de masse, derank — voir utils/moderationExtra.js. Pas de
  // système de warns (exclusion permanente, voir le fichier).
  muterole: moderationExtra.muterole,
  mute: moderationExtra.mute,
  tempmute: moderationExtra.tempmute,
  unmute: moderationExtra.unmute,
  cmute: moderationExtra.cmute,
  tempcmute: moderationExtra.tempcmute,
  uncmute: moderationExtra.uncmute,
  mutelist: moderationExtra.mutelist,
  unmuteall: moderationExtra.unmuteall,
  sanctions: moderationExtra.sanctions,
  baninfo: moderationExtra.baninfo,
  warn: moderationExtra.warn,
  warnings: moderationExtra.warnings,
  unwarn: moderationExtra.unwarn,
  case: moderationExtra.caseView,
  del: (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "sanction") return moderationExtra.delSanction(client, message, args.slice(1));
    if (sub === "perm") return configHandlers.delPerm(client, message, args.slice(1));
  },
  tempban: moderationExtra.tempban,
  banlist: moderationExtra.banlist,
  hideall: moderationExtra.hideall,
  unhideall: moderationExtra.unhideall,
  derank: moderationExtra.derank,

  // Extensions "Gestion du serveur" — voir utils/serverExtra.js.
  choose: serverExtra.choose,
  embed: serverExtra.embedPrompt,
  create: serverExtra.createEmoji,
  massiverole: serverExtra.massiverole,
  unmassiverole: serverExtra.unmassiverole,
  voicemove: serverExtra.voicemove,
  voicekick: serverExtra.voicekick,
  mv: serverExtra.mv,
  bringall: serverExtra.bringall,
  unbanall: serverExtra.unbanall,
  temprole: serverExtra.temprole,
  untemprole: serverExtra.untemprole,
  sync: serverExtra.sync,
  cleanup: serverExtra.cleanup,
  autoreact: serverExtra.autoreact,

  // Vue d'ensemble des permissions par palier — voir utils/permsCommands.js.
  perms: permsCommands.perms,
  helpall: permsCommands.helpall,

  // Utilitaires en lecture seule (listes de membres, fiches, calculatrice,
  // Wikipédia) — voir utils/utilityCommands.js. Aucune permission requise,
  // même famille que &pic/&server/&userinfo.
  alladmins: utilityHandlers.alladmins,
  botadmins: utilityHandlers.botadmins,
  boosters: utilityHandlers.boosters,
  rolemembers: utilityHandlers.rolemembers,
  find: utilityHandlers.find,
  user: utilityHandlers.user,
  member: utilityHandlers.member,
  vocinfo: utilityHandlers.vocinfo,
  emojiinfo: utilityHandlers.emojiinfo,
  calc: utilityHandlers.calc,
  wiki: utilityHandlers.wiki,
  // "search wiki <mot-clé>" est la seule sous-commande de "search" : tout
  // autre mot reste sans réponse, comme n'importe quelle commande inconnue
  // sur ce préfixe partagé avec le CrowBot.
  search: (client, message, args) => {
    if ((args[0] || "").toLowerCase() === "wiki") return utilityHandlers.searchWiki(client, message, args.slice(1));
  },

  // Logs : équivalents texte de &panel > Logs, même store et même création
  // automatique — voir utils/logCommands.js.
  settings: logHandlers.settings,
  autoconfiglog: logHandlers.autoconfiglog,
  modlog: logHandlers.modlog,
  memberlog: logHandlers.memberlog,
  rolelog: logHandlers.rolelog,
  channellog: logHandlers.channellog,
  voicelog: logHandlers.voicelog,
  serverlog: logHandlers.serverlog,
  botlog: logHandlers.botlog,
  messagelog: logHandlers.messagelog,

  // Antiraid : équivalents texte de &panel > Anti-nuke, même store et même
  // whitelist — voir utils/guardCommands.js.
  secur: guardHandlers.secur,
  punition: guardHandlers.punition,
  wl: guardHandlers.wl,
  unwl: guardHandlers.unwl,
  antibot: guardHandlers.antibot,
  antiwebhook: guardHandlers.antiwebhook,
  antiroleadmin: guardHandlers.antiroleadmin,
  antichannel: guardHandlers.antichannel,
  antichanneldelete: guardHandlers.antichanneldelete,
  antirole: guardHandlers.antirole,
  antiroledelete: guardHandlers.antiroledelete,
  antikick: guardHandlers.antikick,
  antiban: guardHandlers.antiban,
  antiunban: guardHandlers.antiunban,
  antieveryone: guardHandlers.antieveryone,
  antijoin: guardHandlers.antijoin,
  creationlimit: guardHandlers.creationlimit,
};

/**
 * À appeler dans l'écouteur "messageCreate" du bot.
 */
async function handleTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { musicMod: MOD_PREFIX } = getPrefixes(message.guild.id);
  const { moderation: MODERATION_PREFIX } = getPrefixes(message.guild.id);

  // Le préfixe "-" est réservé à la modération. Il partage les mêmes
  // handlers que "&", mais jamais le même espace de commande : un mot de
  // gestion tapé sur "-" reste silencieux.
  if (MODERATION_PREFIX && content.startsWith(MODERATION_PREFIX)) {
    const [moderationCmd, ...moderationArgs] = content.slice(MODERATION_PREFIX.length).trim().split(/\s+/);
    const cmdLower = (moderationCmd || "").toLowerCase();
    // "-help" est un cas à part, comme "!!help"/"=help" : le mot "help"
    // n'est volontairement pas dans le catalogue partagé (utils/
    // commandCatalog.js), sous peine de fausser commandRouting.bucketDe pour
    // TOUS les préfixes qui l'utilisent (voir utils/helpNavigator.js).
    if (cmdLower === "help") return helpNavigator.repondreAvecAide("moderation", message);
    if (commandRouting.bucketDe(cmdLower) !== commandRouting.BUCKET_MODERATION) return;
    const handler = modHandlers[cmdLower];
    if (handler) return handler(client, message, moderationArgs);
    return;
  }

  // Préfixe "&" : partagé avec le CrowBot du serveur. On ne traite que les
  // commandes explicitement déclarées dans modHandlers et dont le bucket est
  // la gestion. Les commandes de modération/sécurité ont leurs préfixes
  // dédiés et ne doivent plus répondre ici.
  if (MOD_PREFIX && content.startsWith(MOD_PREFIX)) {
    const [modCmd, ...modArgs] = content.slice(MOD_PREFIX.length).trim().split(/\s+/);
    const cmdLower = (modCmd || "").toLowerCase();
    if (commandRouting.bucketDe(cmdLower) !== commandRouting.BUCKET_GESTION) {
      return;
    }

    // Tapée SANS argument (ou juste avec le mot de sous-commande pour un
    // dispatcher partagé comme &role/&channel/&clear, ex: "role create"),
    // une commande qui a un formulaire dédié ouvre sa carte interactive —
    // voir utils/commandForms.js (BARE_COMMAND_FORMS).
    const secondWord = modArgs.length === 1 && /^[a-z]+$/i.test(modArgs[0]) ? modArgs[0].toLowerCase() : null;
    const bareKey = modArgs.length === 0 ? cmdLower : secondWord ? `${cmdLower} ${secondWord}` : null;
    // Une commande qui vise un membre n'ouvre PAS de carte à vide : sa cible
    // se donne par mention ou identifiant, et sans argument elle rappelle
    // simplement sa syntaxe (voir SANS_CARTE_SANS_ARGUMENT).
    const bareFormKey = bareKey && !commandForms.SANS_CARTE_SANS_ARGUMENT.has(bareKey) ? commandForms.BARE_COMMAND_FORMS[bareKey] : null;
    if (bareFormKey) {
      const form = commandForms.FORMS[bareFormKey];
      if (form && (form.permission == null || can(message.member, form.permission))) {
        return messageOwner.repondreEtRetenir(message, commandForms.buildFormCard(bareFormKey, message.member));
      }
    }

    // Tapée toute seule sans pouvoir tourner ainsi (`&giveaway`, qui n'existe
    // qu'en `giveaway start`/`giveaway reroll`), la commande rappelle ses
    // variantes au lieu de ne rien répondre du tout. Placé APRÈS la carte de
    // formulaire : quand une commande en a une, c'est elle qui prime.
    if (modArgs.length === 0) {
      const rappel = familyHelp.buildFamilyCard(cmdLower, message.member, message.guild.id);
      if (rappel) {
        return message.reply(rappel).catch(async (err) => {
          console.error("[familyHelp] envoi refusé, repli en texte :", err);
          const texte = familyHelp.buildFamilyCard(cmdLower, message.member, message.guild.id, { sansImage: true });
          return texte ? message.reply(texte).catch(() => {}) : undefined;
        });
      }
    }

    // Tapée avec des arguments INSUFFISANTS (ex: "&addrole @membre" sans
    // rôle) plutôt que complètement vides, la même carte s'ouvre — mais
    // PRÉ-REMPLIE avec ce qui a déjà été donné, au lieu d'un message
    // d'erreur "indique un membre ET un rôle". Avec tout le nécessaire déjà
    // fourni, l'exécution directe reste inchangée (habitudes acquises intactes).
    // Ici, au contraire, la carte reste utile : la cible a DÉJÀ été donnée,
    // il ne manque qu'un autre argument (le rôle, la durée...).
    const directFormKey = !bareFormKey && modArgs.length ? commandForms.BARE_COMMAND_FORMS[cmdLower] : null;
    if (directFormKey) {
      const form = commandForms.FORMS[directFormKey];
      if (form && (form.permission == null || can(message.member, form.permission))) {
        const extracted = commandForms.extractFormValues(form, message, modArgs);
        if (!commandForms.structuralFieldsSatisfied(form, extracted)) {
          commandForms.setFormState(message.author.id, directFormKey, extracted);
          return messageOwner.repondreEtRetenir(message, commandForms.buildFormCard(directFormKey, message.member));
        }
      }
    }

    // Quota sur les commandes qui DESSINENT une image. Chaque appel fait
    // tourner le moteur canvas, et le VPS n'a que 458 Mo : quelqu'un qui
    // enchaîne `&help` en boucle mobilise la machine pour rien. Le cache
    // amortit les rendus identiques, pas ceux qui changent de page à chaque
    // fois.
    //
    // Les commandes de MODÉRATION en sont volontairement exclues : bannir dix
    // personnes d'affilée est un usage légitime, et se faire refuser au
    // huitième serait bien pire que le coût du dessin.
    if (COMMANDES_DESSINEES.has(cmdLower)) {
      const { allowed, retryAfterMs } = limiteurDessin.check(message.author.id);
      if (!allowed) {
        const secondes = Math.ceil(retryAfterMs / 1000);
        return message
          .reply({
            embeds: [buildStatusEmbed("error", `Doucement — réessaie dans ${secondes} seconde(s).`)],
          })
          .catch(() => {});
      }
    }

    const handler = modHandlers[cmdLower];
    if (handler) return handler(client, message, modArgs);

    // DERNIER recours, une fois toutes les vraies commandes écartées : le mot
    // est peut-être une commande personnalisée de ce serveur
    // (utils/customCommands.js). L'ordre compte — placé plus haut, une
    // commande personnalisée pourrait masquer une vraie commande du bot.
    // Un mot inconnu, lui, reste sans réponse : le préfixe est partagé avec
    // le CrowBot.
    return customCommands.repondreSiPersonnalisee(message, cmdLower).then(
      () => undefined,
      (err) => console.error("[commandDispatcher] commande personnalisée :", err.message)
    );
  }
}

// Sous-commandes RÉELLEMENT routées par les commandes qui en dispatchent.
// Sans cette table, &help comptait "&set modlogs" ou "&clear owners" comme
// actives au seul motif que "set" et "clear" existent — alors que ces
// sous-mots ne mènent nulle part et que les taper ne fait rien.
//
// Une commande absente d'ici n'a pas de sous-commande : un deuxième mot
// documenté après elle ("server pic") n'est donc pas géré. À tenir à jour
// avec les dispatchers ci-dessus — scripts/test-help-honesty.js vérifie au
// moins que chacune de ces commandes existe bien.
const MOD_SUBCOMMANDS = {
  role: [...serverAdmin.ROLE_ADMIN_SUBCOMMANDS],
  channel: ["create", "delete", "rename", "topic"],
  staff: ["check", "list"],
  gradeladder: ["add", "remove", "list"],
  emoji: ["list", "reset"],
  absence: ["set", "reset"],
  banall: ["message"],
  antinuke: ["punishment", "wlrole", "wluser", "clearwl", "ping", "creationlimit", "autolockdown"],
  backup: ["list", "delete", "load"],
  set: ["name", "pic", "banner", "muterole", "perm"],
  clear: ["sanctions", "all", "perms", "limit"],
  del: ["sanction", "perm"],
  ticket: ["setup", "settings"],
  compteur: ["create", "list", "delete"],
  giveaway: ["start", "reroll"],
  end: ["giveaway"],
  search: ["wiki"],
  badwords: ["on", "off", "add", "del", "clear", "list"],
  autoreact: ["list", "add", "del"],
  remove: ["activity"],
  modlog: ["on", "off"],
  memberlog: ["on", "off"],
  rolelog: ["on", "off"],
  channellog: ["on", "off"],
  voicelog: ["on", "off"],
  serverlog: ["on", "off"],
  botlog: ["on", "off"],
  messagelog: ["on", "off"],
  secur: ["on", "off", "max"],
  antibot: ["on", "off", "max"],
  antiwebhook: ["on", "off", "max"],
  antiroleadmin: ["on", "off", "max"],
  antichannel: ["on", "off", "max"],
  antichanneldelete: ["on", "off", "max"],
  antirole: ["on", "off", "max"],
  antiroledelete: ["on", "off", "max"],
  antikick: ["on", "off", "max"],
  antiban: ["on", "off", "max"],
  antiunban: ["on", "off", "max"],
  antieveryone: ["on", "off", "max"],
  antijoin: ["on", "off", "max"],
  punition: ["all"],
  antispam: ["on", "off"],
  spam: ["allow", "deny", "reset"],
  link: ["allow", "deny", "reset"],
  join: ["settings"],
  leave: ["settings"],
  autorole: ["add", "del", "list"],
  verify: ["setup"],
  stats: ["history"],
  security: ["scan"],
};

// MOD_COMMAND_NAMES est la LISTE DE VÉRITÉ de ce à quoi le bot répond
// vraiment sur le préfixe "&" : &help s'en sert pour ne plus présenter de la
// même façon une commande câblée et une commande seulement documentée (voir
// utils/implementedCommands.js). Dérivée de la table réelle, jamais recopiée
// à la main — les deux ne peuvent donc pas diverger.
module.exports = {
  handleTextCommand,
  // Compatibility for existing external scripts; this is the management
  // dispatcher and no longer handles playback commands.
  handleMusicTextCommand: handleTextCommand,
  MOD_COMMAND_NAMES: Object.keys(modHandlers),
  MOD_SUBCOMMANDS,
  modHandlers,
};
