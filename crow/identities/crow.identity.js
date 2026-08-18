"use strict";

// Identité unique de ce bot : contrairement au projet d'origine (5 bots
// séparés se partageant ce code, chacun avec son token et un sous-ensemble de
// catégories), tout tourne ici dans le process du bot musique, sur un seul
// token, avec TOUTES les catégories activées.
//
// `key` reste "crowall" volontairement : events/ready.event.js ne démarre les
// sweepers giveaway/captcha que pour cette clé, et les tables de config
// (guild_bot_settings, guard_config...) sont partitionnées par identity_key.
//
// `tokenEnv` n'est pas utilisé — le client est créé et connecté par index.js
// avec DISCORD_TOKEN, pas par core/createClient.js.
module.exports = {
    key: "crowall",
    displayName: "Crow",
    defaultPrefix: "&",
    themeColor: "#5865F2",
    // Union des intents des 5 identités d'origine. Le client réel est
    // construit dans index.js (qui y ajoute ceux de la musique) — cette liste
    // sert de référence, core/createClient.js n'est pas utilisé ici.
    intents: [
        "Guilds",
        "GuildMembers",
        "GuildMessages",
        "MessageContent",
        "GuildModeration",
        "GuildWebhooks",
        "GuildVoiceStates",
        "GuildInvites",
        "GuildExpressions",
    ],
    enabledCategories: [
        "admin",
        "antiraid",
        "bl",
        "blr",
        "gestion",
        "giveaway",
        "laisse",
        "limit",
        "logs",
        "moderation",
        "owner",
        "protect",
        "public",
        "voice",
    ],
    enabledCommands: [],
    disabledCommands: [],
};
