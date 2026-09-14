require("dotenv").config();
const path = require("path");
const { REST, Routes } = require("discord.js");

// Voir index.js pour la même liste de fichiers.
const BOT_COMMAND_FILES = {
  musique: ["play.js", "pause.js", "resume.js", "skip.js", "stop.js", "queue.js", "volume.js", "loop.js"],
};

const target = process.argv[2];
if (!BOT_COMMAND_FILES[target]) {
  console.error("Utilisation : node deploy-commands.js musique [--global]");
  console.error("  (par défaut : déploiement sur chaque serveur du bot — instantané)");
  console.error("  --global : déploiement global, s'applique aussi aux futurs serveurs");
  console.error("             mais Discord met jusqu'à 1h à le propager.");
  process.exit(1);
}

const globalMode = process.argv.includes("--global");

const commandsPath = path.join(__dirname, "commands");
const slashCommands = BOT_COMMAND_FILES[target].map((file) => require(path.join(commandsPath, file)).data.toJSON());
const commands = slashCommands;

const token = process.env.DISCORD_TOKEN;
const rest = new REST().setToken(token);

// CLIENT_ID n'est pas toujours renseigné dans .env : l'ID de l'application
// est de toute façon encodé dans la première partie du token.
const applicationId = process.env.CLIENT_ID || Buffer.from(token.split(".")[0], "base64").toString();

(async () => {
  console.log(`⏳ ${slashCommands.length} commande(s) slash...`);

  if (globalMode) {
    const result = await rest.put(Routes.applicationCommands(applicationId), { body: commands });
    console.log(`✅ ${result.length} commande(s) déployée(s) en global (jusqu'à 1h de propagation).`);
    return;
  }

  // Déploiement par serveur : instantané, idéal pour tester. À relancer si le
  // bot rejoint un nouveau serveur (ou passer en --global).
  const guilds = await rest.get(Routes.userGuilds());
  for (const guild of guilds) {
    const result = await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: commands });
    console.log(`✅ ${guild.name} : ${result.length} commande(s) déployée(s) (immédiat).`);
  }

  // Évite les doublons : si des commandes globales traînent, elles
  // s'afficheraient EN PLUS de celles du serveur.
  const globals = await rest.get(Routes.applicationCommands(applicationId));
  if (globals.length) {
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    console.log(`🧹 ${globals.length} commande(s) globale(s) retirée(s) pour éviter les doublons.`);
  }
})();
