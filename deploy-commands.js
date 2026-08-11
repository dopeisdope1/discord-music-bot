require("dotenv").config();
const path = require("path");
const { REST, Routes } = require("discord.js");

// Voir index.js pour la même liste de fichiers.
const BOT_COMMAND_FILES = {
  musique: ["play.js", "pause.js", "resume.js", "skip.js", "stop.js", "queue.js", "volume.js", "loop.js"],
};

const target = process.argv[2];
if (!BOT_COMMAND_FILES[target]) {
  console.error("Utilisation : node deploy-commands.js musique");
  console.error("(Assure-toi que DISCORD_TOKEN/CLIENT_ID dans .env correspondent bien au bot ciblé.)");
  process.exit(1);
}

const commandsPath = path.join(__dirname, "commands");
const commands = BOT_COMMAND_FILES[target].map((file) => require(path.join(commandsPath, file)).data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`⏳ Déploiement de ${commands.length} commande(s) pour le bot "${target}"...`);

    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);

    await rest.put(route, { body: commands });

    console.log("✅ Commandes déployées avec succès.");
  } catch (error) {
    console.error(error);
  }
})();
