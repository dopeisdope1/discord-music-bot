"use strict";

const { getDb } = require("../../db/connection");
const { LEVEL } = require("./permissionLevels");

// Guild owner / Administrator perm always resolves to ADMIN regardless of DB state.
// Otherwise: per-user override (permission_users) beats the highest role-based
// level (permission_roles) among the member's roles, defaulting to NONE.
function resolvePermission(member) {
    if (!member || !member.guild) return LEVEL.NONE;

    if (member.id === member.guild.ownerId) return LEVEL.ADMIN;
    if (member.permissions?.has?.("Administrator")) return LEVEL.ADMIN;

    const db = getDb();
    const guildId = member.guild.id;

    const userRow = db
        .prepare("SELECT level FROM permission_users WHERE guild_id = ? AND user_id = ?")
        .get(guildId, member.id);

    if (userRow) return userRow.level;

    const roleIds = [...member.roles.cache.keys()];
    if (roleIds.length === 0) return LEVEL.NONE;

    const placeholders = roleIds.map(() => "?").join(", ");
    const row = db
        .prepare(
            `SELECT MAX(level) AS level FROM permission_roles WHERE guild_id = ? AND role_id IN (${placeholders})`
        )
        .get(guildId, ...roleIds);

    return row?.level ?? LEVEL.NONE;
}

module.exports = { resolvePermission };
