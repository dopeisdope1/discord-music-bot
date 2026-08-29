/**
 * Publication des commandes slash.
 *
 *   node deploy-commands.js            → sur chaque serveur du bot (instantané)
 *   node deploy-commands.js --global   → global (jusqu'à 1 h de propagation)
 */

const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");

const config = require("./config");

if (!config.token) {
  console.error("❌ DISCORD_TOKEN manquant dans .env");
  process.exit(1);
}

const globalMode = process.argv.includes("--global");

const commandsPath = path.join(__dirname, "commands");
const commands = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"))
  .map((file) => require(path.join(commandsPath, file)).data.toJSON());

const rest = new REST().setToken(config.token);

// L'ID de l'application est encodé dans la première partie du token :
// CLIENT_ID reste donc facultatif.
const applicationId = config.clientId || Buffer.from(config.token.split(".")[0], "base64").toString();

(async () => {
  console.log(`⏳ Publication de ${commands.length} commande(s) : ${commands.map((cmd) => `/${cmd.name}`).join(", ")}`);

  try {
    if (globalMode) {
      const result = await rest.put(Routes.applicationCommands(applicationId), { body: commands });
      console.log(`✅ ${result.length} commande(s) publiée(s) en global (propagation : jusqu'à 1 h).`);
      return;
    }

    const guilds = await rest.get(Routes.userGuilds());
    if (!guilds.length) {
      console.error("❌ Le bot n'est sur aucun serveur : invite-le d'abord, puis relance.");
      process.exit(1);
    }

    for (const guild of guilds) {
      const result = await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: commands });
      console.log(`✅ ${guild.name} : ${result.length} commande(s) disponibles immédiatement.`);
    }

    // Évite les doublons si des commandes globales traînent d'un essai précédent.
    const globals = await rest.get(Routes.applicationCommands(applicationId));
    if (globals.length) {
      await rest.put(Routes.applicationCommands(applicationId), { body: [] });
      console.log(`🧹 ${globals.length} commande(s) globale(s) retirée(s) pour éviter les doublons.`);
    }
  } catch (error) {
    console.error("❌ Publication impossible :", error.message);
    process.exit(1);
  }
})();
