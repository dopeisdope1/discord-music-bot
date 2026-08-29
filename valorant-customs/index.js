/**
 * Bot Discord — parties personnalisées Valorant.
 *
 * Point d'entrée : charge la configuration, les commandes, les événements,
 * puis connecte le client. Toute la logique métier vit dans utils/.
 *
 *   npm run deploy   → publie les commandes slash sur tes serveurs
 *   npm start        → démarre le bot
 */

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Collection, Partials } = require("discord.js");

const config = require("./config");
const store = require("./utils/store");

if (!config.token) {
  console.error("❌ DISCORD_TOKEN manquant : copie .env.example en .env et renseigne le token du bot.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
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

// ---- Chargement des commandes slash ----
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter((name) => name.endsWith(".js"))) {
  const command = require(path.join(commandsPath, file));
  if (!command?.data?.name || typeof command.execute !== "function") {
    console.warn(`⚠️  commands/${file} ignoré : il lui manque "data" ou "execute".`);
    continue;
  }
  client.commands.set(command.data.name, command);
}
console.log(`📦 ${client.commands.size} commande(s) chargée(s) : ${[...client.commands.keys()].map((name) => `/${name}`).join(", ")}`);

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
  console.error("   Vérifie DISCORD_TOKEN, et que les intents « Server Members » et « Presence » requis sont activés sur le portail développeur.");
  process.exit(1);
});
