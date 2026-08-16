// Script de diagnostic jetable. Interroge 5 endpoints avec le token BOT et
// affiche, pour chacun, le code HTTP et le corps brut de la réponse.
// Aucune interprétation, aucun try/catch, aucun fallback.
require("dotenv").config();

const BASE = "https://discord.com/api/v10";
const TOKEN = process.env.DISCORD_TOKEN;

const MON_ID = "1244571048414937179";
const GUILD_ID = "1511087210567307274"; // /memories

const ENDPOINTS = [
  `/users/${MON_ID}`,
  `/users/${MON_ID}/profile`,
  `/users/${MON_ID}/profile?with_mutual_guilds=true`,
  `/guilds/${GUILD_ID}/members/${MON_ID}`,
  `/guilds/${GUILD_ID}/premium/subscriptions`,
];

(async () => {
  for (let i = 0; i < ENDPOINTS.length; i++) {
    const path = ENDPOINTS[i];
    const res = await fetch(BASE + path, { headers: { Authorization: `Bot ${TOKEN}` } });
    const body = await res.text();

    console.log("=".repeat(78));
    console.log(`[${i + 1}] GET ${path}`);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    console.log("-".repeat(78));
    console.log(body);
    console.log();
  }
})();
