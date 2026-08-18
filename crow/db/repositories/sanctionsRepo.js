"use strict";

const { getDb } = require("../connection");

function addSanction({
    guildId,
    targetId,
    type,
    reason,
    moderatorId,
    issuedByIdentity,
    durationMs,
    expiresAt,
}) {
    const db = getDb();
    const result = db
        .prepare(
            `INSERT INTO sanctions
                (guild_id, target_id, type, reason, moderator_id, issued_by_identity, duration_ms, expires_at, active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
            guildId,
            targetId,
            type,
            reason || null,
            moderatorId,
            issuedByIdentity,
            durationMs || null,
            expiresAt || null,
            Date.now()
        );
    return Number(result.lastInsertRowid);
}

function getById(guildId, id) {
    const db = getDb();
    return db.prepare("SELECT * FROM sanctions WHERE guild_id = ? AND id = ?").get(guildId, id);
}

function listByTarget(guildId, targetId) {
    const db = getDb();
    return db
        .prepare("SELECT * FROM sanctions WHERE guild_id = ? AND target_id = ? ORDER BY created_at DESC")
        .all(guildId, targetId);
}

function listActiveByTargetAndType(guildId, targetId, type) {
    const db = getDb();
    return db
        .prepare(
            "SELECT * FROM sanctions WHERE guild_id = ? AND target_id = ? AND type = ? AND active = 1 ORDER BY created_at DESC"
        )
        .all(guildId, targetId, type);
}

function deactivate(guildId, id) {
    const db = getDb();
    db.prepare("UPDATE sanctions SET active = 0 WHERE guild_id = ? AND id = ?").run(guildId, id);
}

function deactivateAllOfType(guildId, targetId, type) {
    const db = getDb();
    db.prepare(
        "UPDATE sanctions SET active = 0 WHERE guild_id = ? AND target_id = ? AND type = ? AND active = 1"
    ).run(guildId, targetId, type);
}

function remove(guildId, id) {
    const db = getDb();
    const result = db.prepare("DELETE FROM sanctions WHERE guild_id = ? AND id = ?").run(guildId, id);
    return Number(result.changes) > 0;
}

function getExpiringActive(now) {
    const db = getDb();
    return db
        .prepare(
            "SELECT * FROM sanctions WHERE active = 1 AND expires_at IS NOT NULL AND expires_at <= ?"
        )
        .all(now);
}

function countByGuild(guildId) {
    const db = getDb();
    return db.prepare("SELECT COUNT(*) AS n FROM sanctions WHERE guild_id = ?").get(guildId).n;
}

function listActiveMutes(guildId) {
    const db = getDb();
    return db
        .prepare(
            "SELECT * FROM sanctions WHERE guild_id = ? AND type IN ('mute','tempmute') AND active = 1 ORDER BY created_at DESC"
        )
        .all(guildId);
}

// --- guild mute role config ---

function setMuteRole(guildId, roleId) {
    const db = getDb();
    db.prepare(
        `INSERT INTO mute_roles (guild_id, role_id) VALUES (?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET role_id = excluded.role_id`
    ).run(guildId, roleId);
}

function getMuteRole(guildId) {
    const db = getDb();
    return db.prepare("SELECT role_id FROM mute_roles WHERE guild_id = ?").get(guildId)?.role_id;
}

module.exports = {
    addSanction,
    getById,
    listByTarget,
    listActiveByTargetAndType,
    deactivate,
    deactivateAllOfType,
    remove,
    getExpiringActive,
    countByGuild,
    listActiveMutes,
    setMuteRole,
    getMuteRole,
};
