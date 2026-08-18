"use strict";

// Lets any service register a handler for buttons/select-menus whose customId
// starts with a given prefix (e.g. "captcha:<guildId>:<userId>" -> prefix
// "captcha"), so events/interactionCreate.event.js doesn't need to know about
// every feature. Call registerButtonHandler(prefix, fn) once at module load in
// the owning service (see services/captchaService.js for the pattern).
const handlers = new Map();

function registerButtonHandler(prefix, handler) {
    handlers.set(prefix, handler);
}

async function dispatchButton(interaction, client, identity) {
    const prefix = interaction.customId.split(":")[0];
    const handler = handlers.get(prefix);
    if (!handler) return false;
    await handler(interaction, client, identity);
    return true;
}

module.exports = { registerButtonHandler, dispatchButton };
