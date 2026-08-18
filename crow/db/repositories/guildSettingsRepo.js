"use strict";

const { getDb } = require("../connection");

function ensureGuild(guildId) {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO guilds (guild_id, first_seen_at) VALUES (?, ?)").run(
        guildId,
        Date.now()
    );
}

function getSettings(guildId, identityKey) {
    const db = getDb();
    return db
        .prepare("SELECT * FROM guild_bot_settings WHERE guild_id = ? AND identity_key = ?")
        .get(guildId, identityKey);
}

function ensureSettingsRow(guildId, identityKey) {
    const db = getDb();
    ensureGuild(guildId);
    db.prepare(
        "INSERT OR IGNORE INTO guild_bot_settings (guild_id, identity_key) VALUES (?, ?)"
    ).run(guildId, identityKey);
}

function setField(guildId, identityKey, field, value) {
    const allowed = new Set([
        "prefix",
        "theme_color",
        "lang",
        "logs_master_enabled",
        "automod_enabled",
        "join_message",
        "join_channel_id",
        "leave_message",
        "leave_channel_id",
        "auto_role_id",
    ]);
    if (!allowed.has(field)) {
        throw new Error(`guildSettingsRepo.setField: unknown field "${field}"`);
    }

    ensureSettingsRow(guildId, identityKey);
    const db = getDb();
    db.prepare(
        `UPDATE guild_bot_settings SET ${field} = ? WHERE guild_id = ? AND identity_key = ?`
    ).run(value, guildId, identityKey);
}

module.exports = { ensureGuild, getSettings, ensureSettingsRow, setField };
