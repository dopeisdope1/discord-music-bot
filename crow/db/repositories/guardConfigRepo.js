"use strict";

const { getDb } = require("../connection");

function getConfig(guildId, identityKey, guardKey) {
    const db = getDb();
    return db
        .prepare(
            "SELECT * FROM guard_config WHERE guild_id = ? AND identity_key = ? AND guard_key = ?"
        )
        .get(guildId, identityKey, guardKey);
}

function setEnabled(guildId, identityKey, guardKey, enabled) {
    const db = getDb();
    db.prepare(
        `INSERT INTO guard_config (guild_id, identity_key, guard_key, enabled)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, identity_key, guard_key)
         DO UPDATE SET enabled = excluded.enabled`
    ).run(guildId, identityKey, guardKey, enabled ? 1 : 0);
}

function toggle(guildId, identityKey, guardKey) {
    const current = getConfig(guildId, identityKey, guardKey);
    const next = !(current?.enabled);
    setEnabled(guildId, identityKey, guardKey, next);
    return next;
}

function setPunition(guildId, identityKey, guardKey, punition) {
    const db = getDb();
    db.prepare(
        `INSERT INTO guard_config (guild_id, identity_key, guard_key, punition)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, identity_key, guard_key)
         DO UPDATE SET punition = excluded.punition`
    ).run(guildId, identityKey, guardKey, punition);
}

function setSettings(guildId, identityKey, guardKey, settingsObj) {
    const db = getDb();
    const json = JSON.stringify(settingsObj || {});
    db.prepare(
        `INSERT INTO guard_config (guild_id, identity_key, guard_key, settings_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, identity_key, guard_key)
         DO UPDATE SET settings_json = excluded.settings_json`
    ).run(guildId, identityKey, guardKey, json);
}

function listEnabled(guildId, identityKey) {
    const db = getDb();
    return db
        .prepare(
            "SELECT * FROM guard_config WHERE guild_id = ? AND identity_key = ? AND enabled = 1"
        )
        .all(guildId, identityKey);
}

// --- watched roles (e.g. secur's list of protected/sensitive roles) ---

function addWatchedRole(guildId, identityKey, guardKey, roleId) {
    const db = getDb();
    db.prepare(
        "INSERT OR IGNORE INTO guard_watched_roles (guild_id, identity_key, guard_key, role_id) VALUES (?, ?, ?, ?)"
    ).run(guildId, identityKey, guardKey, roleId);
}

function removeWatchedRole(guildId, identityKey, guardKey, roleId) {
    const db = getDb();
    db.prepare(
        "DELETE FROM guard_watched_roles WHERE guild_id = ? AND identity_key = ? AND guard_key = ? AND role_id = ?"
    ).run(guildId, identityKey, guardKey, roleId);
}

function listWatchedRoles(guildId, identityKey, guardKey) {
    const db = getDb();
    return db
        .prepare(
            "SELECT role_id FROM guard_watched_roles WHERE guild_id = ? AND identity_key = ? AND guard_key = ?"
        )
        .all(guildId, identityKey, guardKey)
        .map((r) => r.role_id);
}

function clearWatchedRoles(guildId, identityKey, guardKey) {
    const db = getDb();
    db.prepare(
        "DELETE FROM guard_watched_roles WHERE guild_id = ? AND identity_key = ? AND guard_key = ?"
    ).run(guildId, identityKey, guardKey);
}

// --- per-guard bypass whitelist (users/roles exempt from being flagged) ---

function addWhitelist(guildId, identityKey, entityType, entityId) {
    const db = getDb();
    db.prepare(
        "INSERT OR IGNORE INTO guard_whitelist (guild_id, identity_key, entity_type, entity_id) VALUES (?, ?, ?, ?)"
    ).run(guildId, identityKey, entityType, entityId);
}

function removeWhitelist(guildId, identityKey, entityType, entityId) {
    const db = getDb();
    db.prepare(
        "DELETE FROM guard_whitelist WHERE guild_id = ? AND identity_key = ? AND entity_type = ? AND entity_id = ?"
    ).run(guildId, identityKey, entityType, entityId);
}

function listWhitelist(guildId, identityKey) {
    const db = getDb();
    return db
        .prepare("SELECT entity_type, entity_id FROM guard_whitelist WHERE guild_id = ? AND identity_key = ?")
        .all(guildId, identityKey);
}

function isWhitelisted(guildId, identityKey, userId, roleIds = []) {
    const db = getDb();
    const row = db
        .prepare(
            `SELECT 1 FROM guard_whitelist
             WHERE guild_id = ? AND identity_key = ?
             AND ((entity_type = 'user' AND entity_id = ?)
                  OR (entity_type = 'role' AND entity_id IN (${roleIds.map(() => "?").join(",") || "NULL"})))
             LIMIT 1`
        )
        .get(guildId, identityKey, userId, ...roleIds);
    return Boolean(row);
}

// --- raid ping role ---

function setRaidPingRole(guildId, identityKey, roleId) {
    const db = getDb();
    db.prepare(
        `INSERT INTO raid_ping_role (guild_id, identity_key, role_id) VALUES (?, ?, ?)
         ON CONFLICT (guild_id, identity_key) DO UPDATE SET role_id = excluded.role_id`
    ).run(guildId, identityKey, roleId);
}

function getRaidPingRole(guildId, identityKey) {
    const db = getDb();
    return db
        .prepare("SELECT role_id FROM raid_ping_role WHERE guild_id = ? AND identity_key = ?")
        .get(guildId, identityKey)?.role_id;
}

// --- minimum account age requirement ---

function setAccountAgeRequirement(guildId, minAgeMs) {
    const db = getDb();
    db.prepare(
        `INSERT INTO account_age_requirement (guild_id, min_age_ms) VALUES (?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET min_age_ms = excluded.min_age_ms`
    ).run(guildId, minAgeMs);
}

function getAccountAgeRequirement(guildId) {
    const db = getDb();
    return db.prepare("SELECT min_age_ms FROM account_age_requirement WHERE guild_id = ?").get(guildId)
        ?.min_age_ms;
}

function clearAccountAgeRequirement(guildId) {
    const db = getDb();
    db.prepare("DELETE FROM account_age_requirement WHERE guild_id = ?").run(guildId);
}

// --- captcha pending ---

function setCaptchaPending(guildId, userId, code, expiresAt) {
    const db = getDb();
    db.prepare(
        `INSERT INTO captcha_pending (guild_id, user_id, code, attempts, expires_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET code = excluded.code, attempts = 0, expires_at = excluded.expires_at`
    ).run(guildId, userId, code, expiresAt, Date.now());
}

function getCaptchaPending(guildId, userId) {
    const db = getDb();
    return db.prepare("SELECT * FROM captcha_pending WHERE guild_id = ? AND user_id = ?").get(
        guildId,
        userId
    );
}

function incrementCaptchaAttempts(guildId, userId) {
    const db = getDb();
    db.prepare(
        "UPDATE captcha_pending SET attempts = attempts + 1 WHERE guild_id = ? AND user_id = ?"
    ).run(guildId, userId);
}

function clearCaptchaPending(guildId, userId) {
    const db = getDb();
    db.prepare("DELETE FROM captcha_pending WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

module.exports = {
    getConfig,
    setEnabled,
    toggle,
    setPunition,
    setSettings,
    listEnabled,
    addWatchedRole,
    removeWatchedRole,
    listWatchedRoles,
    clearWatchedRoles,
    addWhitelist,
    removeWhitelist,
    listWhitelist,
    isWhitelisted,
    setRaidPingRole,
    getRaidPingRole,
    setAccountAgeRequirement,
    getAccountAgeRequirement,
    clearAccountAgeRequirement,
    setCaptchaPending,
    getCaptchaPending,
    incrementCaptchaAttempts,
    clearCaptchaPending,
};
