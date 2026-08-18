"use strict";

const guildSettingsRepo = require("../db/repositories/guildSettingsRepo");

function setThemeColor(guildId, identityKey, hexColor) {
    guildSettingsRepo.setField(guildId, identityKey, "theme_color", hexColor);
}

function getThemeColor(guildId, identityKey, fallback) {
    const settings = guildSettingsRepo.getSettings(guildId, identityKey);
    return settings?.theme_color || fallback;
}

module.exports = { setThemeColor, getThemeColor };
