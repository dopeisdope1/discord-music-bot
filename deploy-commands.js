require("dotenv").config();
const path = require("path");
const { REST, Routes } = require("discord.js");
const { buildDefinitions: buildContextMenus } = require("./utils/contextMenus");

// Voir index.js pour la même liste de fichiers.
const BOT_COMMAND_FILES = {
  musique: ["play.js", "pause.js", "resume.js", "skip.js", "stop.js", "queue.js", "volume.js", "loop.js"],
};

const target = process.argv[2];
if (!BOT_COMMAND_FILES[target]) {
  console.error("Utilisation : node deploy-commands.js musique");
  console.error("(Assure-toi que DISCORD_TOKEN dans .env correspond bien au bot ciblé.)");
  process.exit(1);
}

const commandsPath = path.join(__dirname, "commands");
const slashCommands = BOT_COMMAND_FILES[target].map((file) => require(path.join(commandsPath, file)).data.toJSON());

// Les menus contextuels (clic droit sur un membre) sont déployés EN MÊME
// TEMPS que les commandes slash : l'API remplace l'intégralité des commandes
// à chaque envoi, donc les déployer séparément effacerait les autres.
const commands = [...slashCommands, ...buildContextMenus()];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

// CLIENT_ID n'est pas toujours renseigné dans .env : l'ID de l'application
// est de toute façon encodé dans la première partie du token.
const applicationId =
  process.env.CLIENT_ID || Buffer.from(process.env.DISCORD_TOKEN.split(".")[0], "base64").toString();

(async () => {
  console.log(
    `⏳ Déploiement de ${slashCommands.length} commande(s) slash + ${commands.length - slashCommands.length} menu(s) contextuel(s)...`
  );

  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(applicationId, process.env.GUILD_ID)
    : Routes.applicationCommands(applicationId);

  const result = await rest.put(route, { body: commands });

  console.log(`✅ ${result.length} commande(s) déployée(s) (${process.env.GUILD_ID ? "serveur " + process.env.GUILD_ID : "global"}).`);
  for (const c of result) console.log(`   [type ${c.type}] ${c.name}`);
})();
