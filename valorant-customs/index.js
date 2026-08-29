/**
 * Bot Discord — parties personnalisées Valorant.
 *
 * Commandes **préfixe uniquement** (aucune slash command) : le préfixe par
 * défaut est `+` et se change depuis le panneau de contrôle, à chaud.
 *
 *   npm start
 */

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Collection, Partials } = require("discord.js");

const config = require("./config");
const store = require("./utils/store");
const settings = require("./utils/settings");
const lock = require("./utils/lock");

if (!config.token) {
  console.error("❌ DISCORD_TOKEN manquant : copie .env.example en .env et renseigne le token du bot.");
  process.exit(1);
}

// Deux instances avec le même token répondraient toutes les deux à chaque
// commande. On refuse de démarrer plutôt que de créer ce chaos.
const held = lock.acquire();
if (!held.ok) {
  console.error(`❌ Une autre instance du bot tourne déjà (PID ${held.pid}, depuis ${held.since}).`);
  console.error("   Arrête-la d'abord, sinon chaque commande recevrait deux réponses.");
  console.error(`   Au besoin : taskkill /PID ${held.pid} /F`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Lecture du contenu des messages : indispensable aux commandes préfixe.
    GatewayIntentBits.MessageContent,
    // Indispensable au système anti-absent : savoir qui est dans quel vocal.
    GatewayIntentBits.GuildVoiceStates,
    // Récupération des membres (déplacements, permissions de salon).
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.GuildMember],
  // Par défaut, AUCUN ping : les mentions restent lisibles et cliquables mais
  // ne notifient personne. Les rares messages qui doivent vraiment notifier
  // (avertissement anti-absent, proposition de place) listent explicitement
  // leurs destinataires via `allowedMentions.users`.
  allowedMentions: { parse: [], repliedUser: false },
});

// ---- Chargement des commandes (nom + alias pointent sur le même module) ----
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter((name) => name.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));
  if (!command?.name || typeof command.execute !== "function") {
    console.warn(`⚠️  commands/${file} ignoré : il lui manque "name" ou "execute".`);
    continue;
  }
  client.commands.set(command.name, command);
  for (const alias of command.aliases || []) client.commands.set(alias, command);
}

const uniqueNames = [...new Set([...client.commands.values()].map((command) => command.name))];
console.log(`📦 ${uniqueNames.length} commande(s) : ${uniqueNames.map((name) => `${settings.get("prefix")}${name}`).join(", ")}`);

// ---- Chargement des événements ----
const eventsPath = path.join(__dirname, "events");
for (const file of fs.readdirSync(eventsPath).filter((name) => name.endsWith(".js"))) {
  const event = require(path.join(eventsPath, file));
  const handler = (...args) => event.execute(...args);
  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

// ---- Robustesse ----
client.on("error", (error) => console.error("[client] Erreur :", error));
process.on("unhandledRejection", (error) => console.error("[process] Promesse rejetée :", error));
process.on("uncaughtException", (error) => console.error("[process] Exception non gérée :", error));
process.on("exit", () => lock.release());

// Arrêt propre : on ne perd jamais une partie en cours (Railway envoie SIGTERM).
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} reçu — sauvegarde des données puis arrêt.`);
    store.saveAllNow();
    client.destroy();
    process.exit(0);
  });
}

client.login(config.token).catch((error) => {
  console.error("❌ Connexion impossible :", error.message);
  console.error("   Vérifie DISCORD_TOKEN, et que les intents « Message Content » et « Server Members »");
  console.error("   sont activés sur le portail développeur (Bot > Privileged Gateway Intents).");
  process.exit(1);
});
