require("dotenv").config();

const http = require("http");

// Replit vérifie qu'un service publié répond sur un port HTTP. Le bot reste un
// processus Discord long terme ; ce serveur minimal sert uniquement aux
// contrôles de santé et n'expose aucune commande ni donnée du bot.
const healthPort = Number(process.env.PORT || 8080);
const healthServer = http.createServer((req, res) => {
  if (req.url === "/api/healthz" || req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

healthServer.listen(healthPort, "0.0.0.0", () => {
  console.log(`[health] écoute sur le port ${healthPort}.`);
});

const { Client, GatewayIntentBits, Collection, MessageFlags } = require("discord.js");
const { handleTextCommand } = require("./utils/musicCommands");
// Raccourci "&p" vers les paliers de permissions, en dehors de la machine à
// états de &panel — voir utils/palierPanel.js.
const palierPanel = require("./utils/palierPanel");
// "&help"/"-help" navigables (menu "Choisir un palier") — voir utils/helpNavigator.js.
const helpNavigator = require("./utils/helpNavigator");
// Commandes "liste" paginées (&bmutelist, &zinkillerlist, &banlist, &mutelist) — voir utils/listNavigator.js.
const listNavigator = require("./utils/listNavigator");
// "&gradeladder"/"&gradeladder list" — panel enrichi (compteurs + badges d'accès par grade) — voir utils/gradeLadderPanel.js.
const gradeLadderPanel = require("./utils/gradeLadderPanel");
// "&staff"/"&staff list" — carte Owner/Sys, bascule du rang sys — voir utils/staffCard.js.
const staffCard = require("./utils/staffCard");
// "&grade <@membre>" — panneau de grade par membre — voir utils/gradeCardPanel.js.
const gradeCardPanel = require("./utils/gradeCardPanel");
// "&baninfo <@membre>" — carte raison/durée avant de bannir — voir utils/banInfoCard.js.
const banInfoCard = require("./utils/banInfoCard");
// "&emoji" — personnalise l'emoji de chaque groupe de l'aide — voir utils/emojiPanel.js.
const emojiPanel = require("./utils/emojiPanel");
// Ban persistant ("&zinkiller") — re-banni automatiquement si débanni
// ailleurs que par "&unzinkiller" (voir l'écouteur guildBanRemove plus bas).
const zinkillerStore = require("./utils/zinkillerStore");
const { report: reportModeration } = require("./utils/moderation/actions");
const { buildStatusEmbed } = require("./utils/statusEmbed");
// Déclencheurs sans préfixe "uo clear" & consorts, distincts de &clear (voir
// utils/selfClear.js et utils/moderationCommands.js) : celui-ci n'efface que
// les messages de son propre auteur, sans permission requise.
const { handleSelfClear } = require("./utils/selfClear");
// "&setclear" — configure les noms/le délai de ces déclencheurs sans préfixe
// (voir utils/setClearCommand.js et utils/selfClearStore.js).
const { handleSetClearTextCommand, handleSetClearInteraction, CUSTOM_ID: SETCLEAR_CUSTOM_ID } = require("./utils/setClearCommand");
const { handleConfigInteraction } = require("./utils/configPanel");
const { handleBanInteraction } = require("./utils/banPanel");
const { handleBanAllInteraction } = require("./utils/banAll");
const levels = require("./utils/levels");
const { revokeIfGone } = require("./utils/permissions/cleanup");
const {
  handleServerAdminInteraction,
  handleConfirmInteraction,
  applyDeroToNewChannel,
} = require("./utils/serverAdminCommands");
const welcomeStore = require("./utils/welcomeStore");
const leaveStore = require("./utils/leaveStore");
const { applyAutoroles } = require("./utils/autoroleCommands");
const { handleVerifyButton } = require("./utils/verification");
const statsStore = require("./utils/statsStore");
const counters = require("./utils/counters");
const messageOwner = require("./utils/messageOwner");
const { handleTicketButton } = require("./utils/tickets");
const { handlePollButton } = require("./utils/polls");
const { handleGiveawayButton, checkExpiredGiveaways } = require("./utils/giveaways");
const { applyPresence } = require("./utils/botProfileCommands");
const { checkExpiredMutes, checkExpiredTempbans } = require("./utils/moderationExtra");
const { checkExpiredTempRoles, applyAutoReact, handleEmbedButton, handleEmbedModal } = require("./utils/serverExtra");
const commandForms = require("./utils/commandForms");
const { relayAuditLogEntry, logMessageDelete, logMessageEdit, logVoiceStateChange } = require("./utils/moderationLog");

// Liste FIXE — construite une seule fois au chargement, jamais recréée à
// chaque clic. Un panneau ne change pas de customId en cours de route.
const PANNEAUX_PRIVES = [
  "cfg:",
  `${commandForms.CARD_ID}:`,
  `${palierPanel.CUSTOM_ID}:`,
  `${helpNavigator.CUSTOM_ID}:`,
  `${listNavigator.CUSTOM_ID}:`,
  `${gradeLadderPanel.CUSTOM_ID}:`,
  `${staffCard.CUSTOM_ID}:`,
  `${gradeCardPanel.CUSTOM_ID}:`,
  `${banInfoCard.CUSTOM_ID}:`,
  `${emojiPanel.CUSTOM_ID}:`,
];

// Mesure de latence sur le chemin critique d'un clic — OFF par défaut, zéro
// coût en prod (DEBUG_LATENCY non défini). Active-la avec DEBUG_LATENCY=true
// (voir le patch posé dans interactionCreate, plus bas) pour voir, pour
// chaque clic : le temps AVANT l'appel Discord (vérif. propriétaire +
// dispatch + construction du payload — tout ce qui est du code à nous,
// contrôlable), et la DURÉE de l'appel Discord lui-même (update()/reply()/
// ... — le temps de traitement de Discord, hors de notre contrôle).
const DEBUG_LATENCY = process.env.DEBUG_LATENCY === "true";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    // Nécessaire à guildAuditLogEntryCreate (voir plus bas) : sans lui, le
    // salon de logs configuré via &panel ne reçoit jamais rien. Non
    // privilégié, aucune activation manuelle requise sur le portail.
    GatewayIntentBits.GuildModeration,
  ],
  // AUCUN ping par défaut, nulle part : ni @everyone/@here, ni rôles, ni
  // utilisateurs, ni ping de réponse. Les mentions restent affichées et
  // cliquables (<@id> s'affiche toujours "@pseudo"), elles ne déclenchent
  // simplement plus de notification — indispensable pour les logs et les
  // réponses de commandes, qui citent constamment des membres.
  allowedMentions: { parse: [], repliedUser: false },
});

// Vérifie périodiquement les giveaways arrivés à échéance (voir
// utils/giveaways.js) — persistés (utils/giveawayStore.js), donc un
// redéploiement pendant qu'un giveaway est en cours ne le fait pas
// disparaître, juste reprendre la vérification au redémarrage.
setInterval(() => {
  checkExpiredGiveaways(client).catch((err) => console.error("[giveaways]", err));
}, 30_000);

// Lève les mutes/bans temporaires arrivés à échéance (&tempmute/&tempban,
// voir utils/moderationExtra.js) — même fréquence que les giveaways.
setInterval(() => {
  checkExpiredMutes(client).catch((err) => console.error("[mute]", err));
  checkExpiredTempbans(client).catch((err) => console.error("[tempban]", err));
  checkExpiredTempRoles(client).catch((err) => console.error("[temprole]", err));
}, 30_000);

// Écrit sur disque les compteurs de &stats history (voir utils/statsStore.js)
// — en mémoire entre-temps, jamais à chaque message.
setInterval(() => {
  statsStore.flush();
}, 60_000);

// Fait tourner les activités configurées (&playto/&listen/&watch/&compet/
// &stream, voir utils/botProfileCommands.js) si plusieurs phrases ont été
// réglées — sans effet si une seule (ou aucune) n'est configurée.
setInterval(() => {
  try {
    applyPresence(client);
  } catch (err) {
    console.error("[botProfile]", err);
  }
}, 15_000);

// Dernier message supprimé par salon, pour &snipe. Volontairement en mémoire
// seulement : l'information est éphémère par nature et n'a aucune raison de
// survivre à un redémarrage.
client.snipes = new Collection();

// ---- Interactions : panneaux de gestion, sécurité et communauté ----
client.on("interactionCreate", async (interaction) => {
  // UN PANNEAU APPARTIENT À QUI L'A OUVERT.
  //
  // `&panel` et les cartes de commande sont des messages publics : n'importe
  // qui pouvait cliquer sur les menus de la carte ouverte par quelqu'un
  // d'autre — au minimum en la faisant changer sous ses yeux, au pire en
  // lançant une action à sa place s'il avait lui aussi le droit. Les
  // permissions ne couvrent pas ce cas : deux modérateurs ont les mêmes, et ce
  // n'est pas une raison pour piloter le panneau de l'autre.
  //
  // Les autres panneaux (bannissement, ban de masse, confirmations
  // d'administration) portaient déjà cette vérification, chacun avec son
  // jeton ; ces deux-là ne l'avaient pas.
  if (DEBUG_LATENCY && (interaction.isButton() || interaction.isAnySelectMenu())) {
    const customId = interaction.customId;
    const debutTraitement = Date.now();
    // Patché UNE fois par interaction : quel que soit le handler qui répond
    // (update/reply/editReply/deferUpdate), on capture le temps écoulé AVANT
    // cet appel (= tout notre code : vérif. propriétaire, dispatch,
    // construction du payload) et la DURÉE de l'appel réseau lui-même.
    for (const methode of ["update", "reply", "editReply", "deferUpdate", "deferReply"]) {
      if (typeof interaction[methode] !== "function") continue;
      const original = interaction[methode].bind(interaction);
      interaction[methode] = async (...args) => {
        const avant = Date.now() - debutTraitement;
        const t0 = Date.now();
        const res = await original(...args);
        const dureeAppel = Date.now() - t0;
        console.log(
          `[latence] "${customId}" — avant l'appel Discord (code bot) : ${avant}ms | appel Discord (${methode}) : ${dureeAppel}ms | total depuis le clic : ${Date.now() - interaction.createdTimestamp}ms`
        );
        return res;
      };
    }
  }

  if (PANNEAUX_PRIVES.some((prefixe) => interaction.customId?.startsWith(prefixe))) {
    const { autorise, proprietaire } = await messageOwner.verifier(interaction);
    if (!autorise) {
      await interaction
        .reply({
          content: `Ce panneau a été ouvert par <@${proprietaire}>. Lance la commande toi-même pour avoir le tien.`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }
  }

  // Panneau de configuration : boutons, menus ET modales passent tous par là
  // (voir utils/configPanel.js). Placé avant le reste car il couvre plusieurs
  // types d'interaction d'un coup ; les commandes slash n'ont pas de customId
  // et ne sont donc pas concernées.
  if (interaction.customId?.startsWith("cfg:")) {
    await handleConfigInteraction(interaction).catch((err) => console.error("[configPanel]", err));
    return;
  }

  // Raccourci "&p" vers les paliers de permissions (voir utils/palierPanel.js).
  if (interaction.customId?.startsWith(`${palierPanel.CUSTOM_ID}:`)) {
    await palierPanel.handlePalierInteraction(interaction).catch((err) => console.error("[palierPanel]", err));
    return;
  }

  // "&help"/"-help" navigables (voir utils/helpNavigator.js).
  if (interaction.customId?.startsWith(`${helpNavigator.CUSTOM_ID}:`)) {
    await helpNavigator.handleHelpNavInteraction(interaction).catch((err) => console.error("[helpNavigator]", err));
    return;
  }

  // Commandes "liste" paginées (voir utils/listNavigator.js).
  if (interaction.customId?.startsWith(`${listNavigator.CUSTOM_ID}:`)) {
    await listNavigator.handleListNavInteraction(interaction).catch((err) => console.error("[listNavigator]", err));
    return;
  }

  // "&gradeladder" — panel enrichi (voir utils/gradeLadderPanel.js).
  if (interaction.customId?.startsWith(`${gradeLadderPanel.CUSTOM_ID}:`)) {
    await gradeLadderPanel.handleGradeLadderInteraction(interaction).catch((err) => console.error("[gradeLadderPanel]", err));
    return;
  }

  // "&staff" — bascule du rang sys (voir utils/staffCard.js).
  if (interaction.customId?.startsWith(`${staffCard.CUSTOM_ID}:`)) {
    await staffCard.handleStaffCardInteraction(interaction).catch((err) => console.error("[staffCard]", err));
    return;
  }

  // "&grade" — panneau de grade par membre (voir utils/gradeCardPanel.js).
  if (interaction.customId?.startsWith(`${gradeCardPanel.CUSTOM_ID}:`)) {
    await gradeCardPanel.handleGradeCardInteraction(interaction).catch((err) => console.error("[gradeCardPanel]", err));
    return;
  }

  // "&baninfo" — carte raison/durée avant de bannir (voir utils/banInfoCard.js).
  if (interaction.customId?.startsWith(`${banInfoCard.CUSTOM_ID}:`)) {
    await banInfoCard.handleBanInfoInteraction(interaction).catch((err) => console.error("[banInfoCard]", err));
    return;
  }

  // "&emoji" — personnalise l'emoji de chaque groupe de l'aide (voir utils/emojiPanel.js).
  if (interaction.customId?.startsWith(`${emojiPanel.CUSTOM_ID}:`)) {
    await emojiPanel.handleEmojiInteraction(interaction).catch((err) => console.error("[emojiPanel]", err));
    return;
  }

  // "&setclear" — voir utils/setClearCommand.js.
  if (interaction.customId?.startsWith(`${SETCLEAR_CUSTOM_ID}:`)) {
    await handleSetClearInteraction(interaction).catch((err) => console.error("[setClearCommand]", err));
    return;
  }

  // Constructeur d'embed (&embed, voir utils/serverExtra.js) : bouton ouvre
  // la modale, la modale postée déclenche l'envoi.
  if (interaction.customId === "srvextra:embedopen") {
    await handleEmbedButton(interaction).catch((err) => console.error("[serverExtra]", err));
    return;
  }
  if (interaction.customId === "srvextra:embed") {
    await handleEmbedModal(interaction).catch((err) => console.error("[serverExtra]", err));
    return;
  }

  // Cartes interactives autonomes postées quand une commande avec
  // formulaire est tapée sans arguments (voir utils/commandForms.js).
  if (interaction.customId?.startsWith(`${commandForms.CARD_ID}:`)) {
    await commandForms.handleFormCardInteraction(interaction).catch((err) => console.error("[commandForms]", err));
    return;
  }

  // Panneau de bannissement de "zinki assasini" (voir utils/banPanel.js).
  if (interaction.customId?.startsWith("ban:")) {
    await handleBanInteraction(interaction).catch((err) => console.error("[banPanel]", err));
    return;
  }

  // Ban de masse (voir utils/banAll.js). Aucune ambiguïté avec le bloc
  // ci-dessus : le deux-points fait partie du préfixe, donc "banall:" ne
  // commence pas par "ban:".
  if (interaction.customId?.startsWith("banall:")) {
    await handleBanAllInteraction(interaction).catch((err) => console.error("[banAll]", err));
    return;
  }

  // Administration serveur : listes paginées (owners/whitelist, "srv:page|
  // add|del:...") et confirmations d'actions sensibles (suppression de
  // rôle/salon, don d'Administrateur — "srv:confirm:go|no:...") — voir
  // utils/serverAdminCommands.js.
  if (interaction.customId?.startsWith("srv:")) {
    const isConfirm = interaction.customId.startsWith("srv:confirm:");
    const handler = isConfirm ? handleConfirmInteraction : handleServerAdminInteraction;
    await handler(interaction).catch((err) => console.error("[serverAdminCommands]", err));
    return;
  }

  // Communauté (voir utils/tickets.js, utils/polls.js, utils/giveaways.js).
  if (interaction.customId?.startsWith("ticket:")) {
    await handleTicketButton(interaction).catch((err) => console.error("[tickets]", err));
    return;
  }
  if (interaction.customId?.startsWith("poll:")) {
    await handlePollButton(interaction).catch((err) => console.error("[polls]", err));
    return;
  }
  if (interaction.customId?.startsWith("giveaway:")) {
    await handleGiveawayButton(interaction).catch((err) => console.error("[giveaways]", err));
    return;
  }
  if (interaction.customId?.startsWith("verify:")) {
    await handleVerifyButton(interaction).catch((err) => console.error("[verification]", err));
    return;
  }

});

// ---- Commandes textuelles préfixées ----
client.on("messageCreate", (message) => {
  // &stats history (voir utils/statsStore.js) : compteur en mémoire, écrit
  // sur disque périodiquement plus bas — jamais à chaque message.
  if (message.guild && !message.author.bot) statsStore.record(message.guild.id, "messages");
  handleTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.", { guildId: message.guild?.id })] })
      .catch(() => {});
  });
  // "&setclear" — voir utils/setClearCommand.js.
  handleSetClearTextCommand(client, message).catch((err) => console.error("[setClearCommand]", err));
  // Déclencheurs "<nom> clear" (configurables via &setclear) — pas de
  // préfixe, ouvert à tout le monde (cooldown par serveur), voir
  // utils/selfClear.js.
  handleSelfClear(client, message).catch((err) => console.error(err));
  // Système de niveaux/XP (&rank, &leaderboard, &levels on/off) — désactivé
  // par défaut par serveur, voir utils/levelStore.js/utils/levels.js.
  levels.checkMessage(client, message).catch((err) => console.error("[levels]", err));
  // Réactions automatiques par salon (&autoreact, voir utils/serverExtra.js).
  applyAutoReact(message).catch((err) => console.error("[autoreact]", err));
});

// ---- Mémorise le dernier message supprimé de chaque salon (voir &snipe) ----
client.on("messageDelete", (message) => {
  if (!message.guild || message.author?.bot) return;
  client.snipes.set(message.channel.id, {
    content: message.content || "*(pas de contenu texte)*",
    authorTag: message.author?.tag || "Inconnu",
    authorAvatar: message.author?.displayAvatarURL?.() || null,
    deletedAt: Date.now(),
  });
  // Salon de logs "Messages" (voir &panel > Logs et utils/moderationLog.js) :
  // uniquement si le message était encore en cache (partiel sinon, sans
  // auteur ni contenu exploitable — rien à journaliser dans ce cas).
  if (message.author) {
    logMessageDelete(client, message).catch((err) => console.error("[moderationLog]", err));
  }
});

// ---- Salon de logs "Messages" : édition (voir &panel > Logs) ----
client.on("messageUpdate", (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  logMessageEdit(client, oldMessage, newMessage).catch((err) => console.error("[moderationLog]", err));
});

// ---- Salon de logs "Vocal" : rejoint/quitté/déplacé (voir &panel > Logs) ----
client.on("voiceStateUpdate", (oldState, newState) => {
  logVoiceStateChange(client, oldState, newState).catch((err) => console.error("[moderationLog]", err));
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  // Réapplique le statut/activité configuré (&online/&idle/&dnd/&invisible,
  // &playto/&listen/&watch/&compet/&stream) — Discord ne le garde pas d'un
  // redémarrage à l'autre, contrairement au reste de la config du bot.
  applyPresence(client);

});

// Nettoyage des accès obsolètes (section 2 du cahier des charges) : quand
// quelqu'un quitte, ses octrois individuels et ses portées globales (sys/
// banall/clear/salon) sont révoqués — SAUF s'il est encore membre d'un autre
// serveur partagé avec le bot (voir utils/permissions/cleanup.js). Les
// octrois PAR RÔLE n'ont rien à nettoyer : ils se recalculent tout seuls sur
// les rôles actuels si la personne revient. L'historique de modération
// n'est jamais touché ici.
client.on("guildMemberRemove", (member) => {
  const changes = revokeIfGone(client, member.guild.id, member.id);
  if (changes.length) {
    console.log(`[accès] ${member.user.tag} a quitté "${member.guild.name}" : ${changes.join(", ")}`);
  }
});

// Message de départ (voir &panel > Bienvenue, utils/leaveStore.js) — même
// principe que le message de bienvenue ci-dessous, listener séparé de la
// révocation d'accès ci-dessus (aucun rapport entre les deux).
client.on("guildMemberRemove", async (member) => {
  const config = leaveStore.getConfig(member.guild.id);
  if (!config.channelId) return;
  const text = leaveStore.pickRandomMessage(member.guild.id);
  if (!text) return;

  const channel = member.guild.channels.cache.get(config.channelId);
  if (!channel?.isTextBased()) return;

  // Contrairement à l'arrivée, la personne n'est plus mentionnable une fois
  // partie : "{user}" est remplacé par son pseudo brut, jamais une mention.
  const content = text.replace(/\{user\}/g, member.user.tag);

  const sent = await channel.send({ content }).catch((err) => {
    console.error("[leave] échec d'envoi :", err.message);
    return null;
  });
  if (sent && config.autoDeleteSeconds > 0) {
    setTimeout(() => sent.delete().catch(() => {}), config.autoDeleteSeconds * 1000);
  }
});

// Dero automatique (voir &dero, utils/serverAdminCommands.js) : applique les
// permissions configurées aux rôles concernés sur chaque nouveau salon créé,
// sans action manuelle. Ne fait rien si aucun rôle n'est configuré.
client.on("channelCreate", (channel) => {
  applyDeroToNewChannel(channel).catch((err) => console.error("[dero]", err));
});

// Message de bienvenue (voir &panel > Bienvenue, utils/welcomeStore.js) : un
// message est tiré au hasard parmi ceux configurés, "{user}" y est remplacé
// par une mention du nouvel arrivant. Ne fait rien tant qu'aucun salon ou
// aucun message n'est configuré.
client.on("guildMemberAdd", async (member) => {
  const config = welcomeStore.getConfig(member.guild.id);
  if (!config.channelId) return;
  const text = welcomeStore.pickRandomMessage(member.guild.id);
  if (!text) return;

  const channel = member.guild.channels.cache.get(config.channelId);
  if (!channel?.isTextBased()) return;

  // "{user}" place la mention où on veut dans le texte ; sans lui, la
  // mention est ajoutée automatiquement devant — un message de bienvenue
  // doit pinger l'arrivant par défaut, pas seulement si on connaît la syntaxe.
  const mention = `<@${member.id}>`;
  const content = text.includes("{user}") ? text.replace(/\{user\}/g, mention) : `${mention} ${text}`;

  const sent = await channel.send({ content, allowedMentions: { users: [member.id] } }).catch((err) => {
    console.error("[welcome] échec d'envoi :", err.message);
    return null;
  });
  if (sent && config.autoDeleteSeconds > 0) {
    setTimeout(() => sent.delete().catch(() => {}), config.autoDeleteSeconds * 1000);
  }
});

// Rôles automatiques à l'arrivée (voir &panel > Membres, utils/autoroleCommands.js).
client.on("guildMemberAdd", (member) => {
  applyAutoroles(member).catch((err) => console.error("[autorole]", err));
});

// Statistiques historiques (&stats history, voir utils/statsStore.js).
client.on("guildMemberAdd", (member) => statsStore.record(member.guild.id, "joins"));
client.on("guildMemberRemove", (member) => statsStore.record(member.guild.id, "leaves"));

// Compteurs de serveur (voir utils/counters.js). Chaque appel est borné à un
// renommage par salon toutes les 6 minutes : Discord n'en autorise que deux
// par tranche de 10, et un compteur qui dépasse ce quota se fige sur une
// valeur périmée SANS erreur visible. On peut donc brancher les événements
// sans précaution supplémentaire ici.
client.on("guildMemberAdd", (member) => counters.mettreAJour(member.guild).catch(() => {}));
client.on("guildMemberRemove", (member) => counters.mettreAJour(member.guild).catch(() => {}));
// Le nombre de boosts change par une mise à jour de SERVEUR, pas de membre.
client.on("guildUpdate", (_avant, apres) => counters.mettreAJour(apres).catch(() => {}));

// Journal de modération (voir utils/moderationLog.js) : chaque entrée
// d'audit Discord — ban, kick, timeout, salon/rôle supprimé, etc. — est
// relayée vers le salon configuré via &panel > Logs, quel qu'en soit
// l'auteur : ce bot (&ban/&unban/&banall), le CrowBot du serveur, ou un
// modérateur humain. Ne fait rien si aucun salon n'est configuré.
client.on("guildAuditLogEntryCreate", (entry, guild) => {
  relayAuditLogEntry(client, guild, entry).catch((err) => {
    console.error("[moderationLog] échec du relais d'une entrée d'audit :", err);
  });
});

// Ban persistant ("&zinkiller", voir utils/zinkillerStore.js) : si la
// personne est débannie autrement que par "&unzinkiller" (Discord natif, un
// autre bot...), le store porte encore son entrée à ce stade — "&unzinkiller"
// la retire AVANT de débannir, donc son propre débannissement ne redéclenche
// jamais ce re-ban.
client.on("guildBanRemove", async (ban) => {
  const guild = ban.guild;
  if (!zinkillerStore.isZinkilled(guild.id, ban.user.id)) return;
  try {
    await guild.members.ban(ban.user.id, { reason: "Ban persistant (&zinkiller) — re-banni automatiquement" });
    console.log(`[zinkiller] ${ban.user.tag} re-banni automatiquement sur "${guild.name}".`);
    await reportModeration(client, {
      guildId: guild.id,
      category: "moderation",
      title: "Zinkiller — re-ban automatique",
      fields: [{ label: "Cible", value: `<@${ban.user.id}> (${ban.user.id})` }],
      action: "zinkiller-reban",
      targetId: ban.user.id,
      targetTag: ban.user.tag,
      moderator: client.user,
    });
  } catch (err) {
    console.error(`[zinkiller] échec du re-ban de ${ban.user.tag} :`, err.message);
  }
});

// Dernier rempart. Sous Node, une promesse rejetée sans preneur arrête le
// process entier : une erreur réseau isolée sur une requête Discord ou un
// salon devenu inaccessible ne doit pas arrêter tout le service. Ces incidents
// sont sans conséquence pour les autres fonctions du bot.
// Ils restent visibles dans les logs, ce n'est pas une façon de les masquer.
process.on("unhandledRejection", (reason) => {
  console.error("[bot] promesse rejetée sans traitement :", reason?.stack || reason);
});
process.on("uncaughtException", (err) => {
  console.error("[bot] exception non rattrapée :", err?.stack || err);
});

// Sans handler, Node.js termine le process instantanément sur SIGTERM. Laisse
// une courte marge pour fermer proprement la connexion Discord.
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] Signal ${signal} reçu, arrêt dans 3s...`);
  statsStore.flush(); // sinon jusqu'à 60s de &stats history perdues à chaque redéploiement

  await new Promise((resolve) => setTimeout(resolve, 3000));
  client.destroy();
  healthServer.close();
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// La connexion à Discord, elle, reste fatale : un bot qui n'a pas pu se
// connecter ne sert à rien, autant sortir pour que l'hébergeur le relance
// plutôt que de laisser tourner un process muet (le filet ci-dessus, sans ce
// catch, transformerait un jeton invalide en bot silencieux et immortel).
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("[bot] connexion à Discord impossible :", err.message);
  process.exit(1);
});

// Même principe que le catch ci-dessus, pour un cas vécu en production :
// process vivant, AUCUNE erreur/déconnexion journalisée, mais la session
// gateway bien morte en silence — &online (et tout le reste) ne répondait
// plus rien après ~1h30.
//
// Ce qu'on surveille doit être un signe de vie du WEBSOCKET, pas l'activité
// des serveurs. La première version guettait l'événement "raw" en le croyant
// émis à chaque paquet gateway, accusés de battement de cœur compris : c'est
// faux. Discord.js n'émet "raw" que sur les paquets DISPATCH (message,
// présence, interaction, entrée/sortie vocale...) ; les accusés de battement
// de cœur (opcode 11) sont traités en interne et n'arrivent jamais jusqu'à
// "raw". Sur un serveur calme — la nuit, ou simplement quelques minutes sans
// personne — trois minutes sans le moindre DISPATCH sont parfaitement
// normales, et le garde-fou tuait alors un bot en parfaite santé, en boucle :
// le bot se déconnectait puis revenait sans arrêt.
//
// On lit donc l'horodatage du dernier battement de cœur ACQUITTÉ, que
// discord.js tient à jour sur chaque shard (`lastPingTimestamp`). Il avance
// à chaque acquittement, soit environ toutes les 41 s, qu'il se passe quelque
// chose ou non sur les serveurs — un silence de 3 minutes là-dessus veut donc
// bien dire que la connexion est figée. "raw" reste pris en compte comme
// signal d'appoint. Rien pendant GATEWAY_STALE_MS => on force la sortie
// plutôt que de tenter une reconnexion incertaine en place ; l'hébergeur
// relance un process tout neuf avec une session propre (mêmes garanties de
// restart que le login raté ci-dessus).
const GATEWAY_WATCHDOG_MS = 60_000;
const GATEWAY_STALE_MS = 3 * 60_000;
let lastGatewayActivity = Date.now();
client.on("raw", () => {
  lastGatewayActivity = Date.now();
});

/**
 * Date du dernier battement de cœur acquitté, tous shards confondus.
 * Vaut 0 tant qu'aucun acquittement n'est revenu (shard en cours de
 * connexion : `lastPingTimestamp` vaut -1), auquel cas seul le compteur
 * "raw" ci-dessus fait foi — on ne veut pas qu'un bot en train de démarrer
 * se fasse tuer par son propre garde-fou.
 */
function lastHeartbeatAck() {
  let last = 0;
  for (const shard of client.ws?.shards?.values() ?? []) {
    if (shard.lastPingTimestamp > last) last = shard.lastPingTimestamp;
  }
  return last;
}

setInterval(() => {
  const silence = Date.now() - Math.max(lastGatewayActivity, lastHeartbeatAck());
  if (silence < GATEWAY_STALE_MS) return;
  console.error(
    `[gateway] garde-fou : aucun battement de cœur depuis ${Math.round(silence / 1000)}s — connexion probablement figée, redémarrage forcé.`
  );
  process.exit(1);
}, GATEWAY_WATCHDOG_MS);
console.log(`[gateway] garde-fou armé, vérification toutes les ${GATEWAY_WATCHDOG_MS / 1000}s (seuil : ${GATEWAY_STALE_MS / 1000}s).`);
