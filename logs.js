require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { handleLogsTextCommand } = require("./utils/logsCommands");
const { buildStatusEmbed } = require("./utils/statusEmbed");
const { loadGuildConfig } = require("./utils/configChannel");
const { sendLog } = require("./utils/actionLogger");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Nécessaire pour lire la commande textuelle "=logs" et le contenu des
    // messages supprimés/édités (catégories "messages"/"embeds") — à activer
    // manuellement sur le portail développeur Discord (Bot > intents
    // privilégiés).
    GatewayIntentBits.MessageContent,
    // Nécessaire pour les logs "vocal" (arrivée/départ/déplacement) — natif,
    // pas besoin d'activation manuelle.
    GatewayIntentBits.GuildVoiceStates,
    // Nécessaire pour les logs "joinleave" (arrivée/départ de membres) — à
    // activer manuellement sur le portail développeur Discord, comme
    // MESSAGE CONTENT ci-dessus.
    GatewayIntentBits.GuildMembers,
    // Nécessaire pour les logs "automod" (messages bloqués par l'AutoMod
    // natif de Discord).
    GatewayIntentBits.AutoModerationExecution,
  ],
  allowedMentions: { parse: ["users"], repliedUser: true },
});

client.on("messageCreate", (message) => {
  handleLogsTextCommand(client, message).catch((err) => {
    console.error(err);
    message
      .reply({ embeds: [buildStatusEmbed("error", "Une erreur est survenue lors du traitement de la commande.")] })
      .catch(() => {});
  });
});

// ---- Logs "messages"/"embeds" : contenu supprimé/édité, perdu autrement ----
client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;
  if (message.partial) return; // contenu pas en cache, rien à loguer

  await sendLog(client, message.guild.id, "messages", {
    title: "Message supprimé",
    description: `Dans ${message.channel} :\n> ${message.content || "*[contenu vide ou non textuel]*"}`,
    actor: message.author,
  });

  if (message.embeds?.length) {
    const summary = message.embeds
      .map((e, i) => `**Embed ${i + 1}**${e.title ? ` — ${e.title}` : ""}${e.description ? `\n${e.description}` : ""}`)
      .join("\n\n");
    await sendLog(client, message.guild.id, "embeds", {
      title: "Embed perdu (message supprimé)",
      description: `Dans ${message.channel} :\n${summary}`,
      actor: message.author,
    });
  }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.partial || newMessage.partial) return;
  if (oldMessage.content === newMessage.content) return;

  await sendLog(client, newMessage.guild.id, "messages", {
    title: "Message édité",
    description: `Dans ${newMessage.channel} ([aller au message](${newMessage.url})) :\n**Avant :** ${
      oldMessage.content || "*[vide]*"
    }\n**Après :** ${newMessage.content || "*[vide]*"}`,
    actor: newMessage.author,
  });
});

// ---- Logs "vocal" : arrivée/départ/déplacement en salon vocal ----
client.on("voiceStateUpdate", async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member) return;

  if (!oldState.channelId && newState.channelId) {
    await sendLog(client, newState.guild.id, "vocal", {
      title: "Rejoint un salon vocal",
      description: `${member} a rejoint ${newState.channel}.`,
      actor: member.user,
    });
  } else if (oldState.channelId && !newState.channelId) {
    await sendLog(client, oldState.guild.id, "vocal", {
      title: "Quitté un salon vocal",
      description: `${member} a quitté ${oldState.channel}.`,
      actor: member.user,
    });
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    await sendLog(client, newState.guild.id, "vocal", {
      title: "Changé de salon vocal",
      description: `${member} est passé de ${oldState.channel} à ${newState.channel}.`,
      actor: member.user,
    });
  }
});

// ---- Logs "joinleave" : arrivée/départ de membres (log staff, distinct du
// message de bienvenue public — voir utils/welcomeStore.js) ----
client.on("guildMemberAdd", async (member) => {
  await sendLog(client, member.guild.id, "joinleave", {
    title: "Membre arrivé",
    description: `${member} (\`${member.id}\`) a rejoint le serveur.`,
    actor: member.user,
    fields: [{ name: "Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }],
  });
});

client.on("guildMemberRemove", async (member) => {
  await sendLog(client, member.guild.id, "joinleave", {
    title: "Membre parti",
    description: `**${member.user.tag}** (\`${member.id}\`) a quitté le serveur.`,
    actor: member.user,
  });
});

// ---- Logs "automod" : messages bloqués par l'AutoMod natif de Discord ----
client.on("autoModerationActionExecution", async (execution) => {
  await sendLog(client, execution.guild.id, "automod", {
    title: "Message bloqué par l'AutoMod",
    description: `Règle **${execution.ruleId}** déclenchée dans <#${execution.channelId}>.\n> ${
      execution.content || "*[contenu non fourni]*"
    }`,
    actor: execution.member?.user,
  });
});

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  for (const guild of client.guilds.cache.values()) {
    // Restaure la config (salons de logs, + lecture du préfixe modération
    // pour l'affichage dans =logs) : le disque du container Railway est
    // réinitialisé à chaque redéploiement, donc sans ça la config choisie
    // reviendrait aux valeurs par défaut à chaque push (voir
    // utils/configChannel.js, qui sauvegarde tout ça dans un salon Discord
    // caché partagé avec les autres bots).
    loadGuildConfig(guild).catch((err) => {
      console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
    });
  }
});

client.on("guildCreate", (guild) => {
  loadGuildConfig(guild).catch((err) => {
    console.warn(`⚠️ Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
  });
});

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] Signal ${signal} reçu, arrêt dans 3s (le temps que les sauvegardes en cours se terminent)...`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  client.destroy();
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

client.login(process.env.DISCORD_TOKEN);
