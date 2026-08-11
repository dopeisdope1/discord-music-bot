const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { announceIdentity } = require("./botIntro");
const { getPrefixes } = require("./prefixStore");
const { loadGuildConfig } = require("./configChannel");

/**
 * Démarre le bot Voice-Hub (salons vocaux privés/temporaires, façon
 * CrowMASTER) comme une SECONDE identité Discord dans ce même process Node —
 * pas un service Railway séparé, pour rester sous la limite de 5 services du
 * plan gratuit (déjà atteinte une fois). À appeler depuis gestion.js.
 *
 * Pour l'instant : connexion + identification (`identify`) uniquement — le
 * jeu de commandes complet (pv/acces/find/join/mv/...) arrive dans une
 * prochaine étape.
 * @returns {import('discord.js').Client|null} null si VOICEHUB_TOKEN n'est pas configuré
 */
function startVoiceHub() {
  const token = process.env.VOICEHUB_TOKEN;
  if (!token) {
    console.warn("[voicehub] VOICEHUB_TOKEN absent — bot Voice-Hub non démarré.");
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    allowedMentions: { parse: ["users"], repliedUser: true },
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;
    const { voiceHub: PREFIX } = getPrefixes(message.guild.id);
    const content = message.content.trim();
    if (!content.startsWith(PREFIX)) return;

    const [cmdRaw] = content.slice(PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();

    if (cmd === "identify") {
      if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) return;
      const ok = await announceIdentity(client, message.guild, {
        emoji: "🔊",
        name: "Voice-Hub",
        description: `Gestion des salons vocaux (préfixe \`${PREFIX}\`) — en cours de construction, salons privés/temporaires à venir.`,
      });
      await message
        .reply({
          embeds: [
            buildStatusEmbed(ok ? "success" : "error", ok ? "Pseudo mis à jour et message envoyé." : "Pseudo mis à jour, mais aucun salon accessible pour poster le message."),
          ],
        })
        .catch(() => {});
      return;
    }

    if (cmd === "help") {
      await message
        .reply({ embeds: [buildStatusEmbed("info", `Préfixe : \`${PREFIX}\`. Salons vocaux privés/temporaires — fonctionnalités en cours d'ajout.`)] })
        .catch(() => {});
    }
  });

  client.once("ready", () => {
    console.log(`✅ Voice-Hub connecté en tant que ${client.user.tag}`);
    for (const guild of client.guilds.cache.values()) {
      loadGuildConfig(guild).catch((err) => {
        console.warn(`⚠️ [voicehub] Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
      });
    }
  });

  client.on("guildCreate", (guild) => {
    loadGuildConfig(guild).catch((err) => {
      console.warn(`⚠️ [voicehub] Impossible de restaurer la config du serveur "${guild.name}":`, err.message);
    });
  });

  client.login(token).catch((err) => {
    console.error("[voicehub] Échec de connexion :", err.message);
  });

  return client;
}

module.exports = { startVoiceHub };
