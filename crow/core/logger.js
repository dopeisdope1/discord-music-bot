"use strict";

function tag(identityKey, guildId) {
    return `[${identityKey}]${guildId ? `[${guildId}]` : ""}`;
}

function info(identityKey, guildId, ...args) {
    console.log(tag(identityKey, guildId), ...args);
}

function warn(identityKey, guildId, ...args) {
    console.warn(tag(identityKey, guildId), ...args);
}

function error(identityKey, guildId, ...args) {
    console.error(tag(identityKey, guildId), ...args);
}

module.exports = { info, warn, error };
