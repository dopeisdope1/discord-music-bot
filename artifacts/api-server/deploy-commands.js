require("dotenv").config();
const { REST, Routes } = require("discord.js");

/**
 * This bot no longer publishes application commands.  Keeping this script as
 * an explicit cleanup operation is intentional: Discord retains previously
 * registered slash commands until they are removed through the API.
 *
 * By default commands are removed from every guild the bot can see. Pass
 * --global to remove the global command set as well (or use both modes when
 * retiring an older installation).
 */
const globalMode = process.argv.includes("--global");
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("DISCORD_TOKEN est requis pour retirer les commandes slash.");
  process.exit(1);
}

const rest = new REST().setToken(token);
const applicationId = process.env.CLIENT_ID || Buffer.from(token.split(".")[0], "base64").toString();

(async () => {
  if (globalMode) {
    const existing = await rest.get(Routes.applicationCommands(applicationId));
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    console.log(`🧹 ${existing.length} commande(s) globale(s) retirée(s).`);
    return;
  }

  const guilds = await rest.get(Routes.userGuilds());
  for (const guild of guilds) {
    const existing = await rest.get(Routes.applicationGuildCommands(applicationId, guild.id));
    await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: [] });
    console.log(`🧹 ${guild.name} : ${existing.length} commande(s) retirée(s).`);
  }
})();