"use strict";

const { Events } = require("discord.js");
const tempVoiceService = require("../services/tempVoiceService");

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(client, identity, oldState, newState) {
        // voice_config is guild-scoped: both crowmaster (its own hub/category
        // commands) and crowall (gestion:tempvoc) can write it, so both must be
        // able to act on it. tempVoiceService no-ops instantly if unconfigured,
        // and createTempChannelFor() de-dupes if both identities are installed
        // in the same guild and react to the same event.
        if (identity.key !== "crowmaster" && identity.key !== "crowall") return;
        await tempVoiceService.handleVoiceStateUpdate(oldState, newState, identity).catch(() => {});
    },
};
