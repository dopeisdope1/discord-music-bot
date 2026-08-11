const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { getDeroRole, setDeroRole, getCounter, setCounter } = require("./toolsStore");
const { saveGuildConfig } = require("./configChannel");
const { sendLog } = require("./actionLogger");

const COUNTER_UPDATE_MS = 10 * 60_000; // Discord limite les renommages de salon — 10 min = marge large et sûre

/**
 * `.dero` (statut) / `.dero set @role` / `.dero off` — un rôle qui reçoit
 * automatiquement l'accès (Voir + Envoyer/Se connecter) à chaque nouveau
 * salon créé sur le serveur (ex: un rôle staff qui doit toujours pouvoir
 * accéder à tout, même les futurs salons). Voir registerToolsAutomation
 * pour la partie automatique (écoute channelCreate).
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleDeroCommand(message, args) {
  const sub = (args[0] || "").toLowerCase();

  if (!sub) {
    const roleId = getDeroRole(message.guild.id);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          roleId
            ? `Rôle appliqué automatiquement sur les nouveaux salons : <@&${roleId}>.`
            : "Aucun rôle configuré (désactivé)."
        ),
      ],
    });
  }

  if (sub === "off") {
    setDeroRole(message.guild.id, null);
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "salon", {
      title: "Dero automatique désactivé",
      description: "Plus aucun rôle appliqué automatiquement sur les nouveaux salons.",
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", "Dero automatique désactivé.")] });
  }

  if (sub === "set") {
    const role = message.mentions.roles?.first();
    if (!role) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Utilisation : `.dero set @role`.")] });
    }
    setDeroRole(message.guild.id, role.id);
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "salon", {
      title: "Dero automatique configuré",
      description: `<@&${role.id}> sera automatiquement ajouté (accès complet) à chaque nouveau salon.`,
      actor: message.author,
    });
    return message.reply({
      embeds: [buildStatusEmbed("success", `<@&${role.id}> aura automatiquement accès à chaque nouveau salon créé.`)],
    });
  }

  return message.reply({ embeds: [buildStatusEmbed("error", "Utilisation : `.dero` (statut), `.dero set @role` ou `.dero off`.")] });
}

/**
 * `.counter` (statut) / `.counter set #salon [modèle]` / `.counter off` —
 * renomme périodiquement un salon vocal pour afficher le nombre de membres
 * du serveur (`{count}` dans le modèle, ex: "Membres: {count}"). Mis à jour
 * toutes les 10 minutes (voir registerToolsAutomation) — Discord limite
 * fortement les renommages de salon, une fréquence plus rapide échouerait.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleCounterCommand(message, args) {
  const sub = (args[0] || "").toLowerCase();

  if (!sub || sub === "status") {
    const { channelId, template } = getCounter(message.guild.id);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          channelId ? `Salon compteur : <#${channelId}>, modèle : \`${template}\`.` : "Aucun compteur configuré (désactivé)."
        ),
      ],
    });
  }

  if (sub === "off") {
    setCounter(message.guild.id, null, null);
    await saveGuildConfig(message.guild);
    return message.reply({ embeds: [buildStatusEmbed("success", "Compteur désactivé.")] });
  }

  if (sub === "set") {
    const channel = message.mentions.channels?.first();
    if (!channel) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Utilisation : `.counter set #salon [modèle]` (modèle par défaut : `Membres: {count}`).")],
      });
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les salons**.")] });
    }
    const template = args.slice(2).join(" ") || "Membres: {count}";
    if (!template.includes("{count}")) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Le modèle doit contenir `{count}` (ex: `Membres: {count}`).")] });
    }
    setCounter(message.guild.id, channel.id, template);
    await saveGuildConfig(message.guild);

    const count = message.guild.memberCount;
    await channel.setName(template.replace("{count}", count)).catch(() => {});

    return message.reply({
      embeds: [buildStatusEmbed("success", `Compteur activé sur ${channel} (modèle : \`${template}\`) — mis à jour toutes les 10 min.`)],
    });
  }

  return message.reply({
    embeds: [buildStatusEmbed("error", "Utilisation : `.counter` (statut), `.counter set #salon [modèle]` ou `.counter off`.")],
  });
}

/**
 * Branche l'automatisation de `.dero`/`.counter` : applique le rôle dero à
 * chaque nouveau salon, et met à jour tous les compteurs vocaux toutes les
 * 10 minutes. À appeler une fois au démarrage (voir index.js).
 * @param {import('discord.js').Client} client
 */
function registerToolsAutomation(client) {
  client.on("channelCreate", async (channel) => {
    if (!channel.guild || !channel.permissionOverwrites) return;
    const roleId = getDeroRole(channel.guild.id);
    if (!roleId) return;
    const role = channel.guild.roles.cache.get(roleId);
    if (!role) return;

    await channel.permissionOverwrites
      .edit(role, {
        ViewChannel: true,
        SendMessages: true,
        Connect: true,
      })
      .catch((err) => console.error("[tools] Échec de l'application du dero automatique :", err));
  });

  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const { channelId, template } = getCounter(guild.id);
      if (!channelId) continue;
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;

      const newName = template.replace("{count}", guild.memberCount);
      if (channel.name === newName) continue;
      await channel.setName(newName).catch((err) => console.error(`[tools] Échec de la mise à jour du compteur sur "${guild.name}" :`, err.message));
    }
  }, COUNTER_UPDATE_MS);
}

module.exports = { handleDeroCommand, handleCounterCommand, registerToolsAutomation };
