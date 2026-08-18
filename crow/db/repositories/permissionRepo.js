"use strict";

const { getDb } = require("../connection");

function setRoleLevel(guildId, roleId, level) {
    const db = getDb();
    db.prepare(
        `INSERT INTO permission_roles (guild_id, role_id, level) VALUES (?, ?, ?)
         ON CONFLICT (guild_id, role_id) DO UPDATE SET level = excluded.level`
    ).run(guildId, roleId, level);
}

function removeRoleLevel(guildId, roleId) {
    const db = getDb();
    db.prepare("DELETE FROM permission_roles WHERE guild_id = ? AND role_id = ?").run(guildId, roleId);
}

function listRoles(guildId) {
    const db = getDb();
    return db.prepare("SELECT role_id, level FROM permission_roles WHERE guild_id = ?").all(guildId);
}

function listRoleIdsAtLevel(guildId, level) {
    const db = getDb();
    return db
        .prepare("SELECT role_id FROM permission_roles WHERE guild_id = ? AND level = ?")
        .all(guildId, level)
        .map((r) => r.role_id);
}

function setUserLevel(guildId, userId, level) {
    const db = getDb();
    db.prepare(
        `INSERT INTO permission_users (guild_id, user_id, level) VALUES (?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET level = excluded.level`
    ).run(guildId, userId, level);
}

function removeUserLevel(guildId, userId) {
    const db = getDb();
    db.prepare("DELETE FROM permission_users WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

function listUsers(guildId) {
    const db = getDb();
    return db.prepare("SELECT user_id, level FROM permission_users WHERE guild_id = ?").all(guildId);
}

function listUsersAtLevel(guildId, level) {
    const db = getDb();
    return db
        .prepare("SELECT user_id FROM permission_users WHERE guild_id = ? AND level = ?")
        .all(guildId, level)
        .map((r) => r.user_id);
}

function clearAll(guildId) {
    const db = getDb();
    db.prepare("DELETE FROM permission_roles WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM permission_users WHERE guild_id = ?").run(guildId);
}

module.exports = {
    setRoleLevel,
    removeRoleLevel,
    listRoles,
    listRoleIdsAtLevel,
    setUserLevel,
    removeUserLevel,
    listUsers,
    listUsersAtLevel,
    clearAll,
};
