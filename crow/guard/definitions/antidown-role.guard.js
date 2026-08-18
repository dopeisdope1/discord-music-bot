"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const tracker = require("../antiDownTracker");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

// Second half of the "antidown" guard_key, watching role deletions (the other
// classic nuke vector alongside mass channel deletion). See
// antidown-channel.guard.js for the shared design rationale.
module.exports = {
    key: "antidown",
    discordEvent: Events.GuildRoleDelete,
    async matcher(role) {
        return { guildId: role.guild.id, client: role.client, guild: role.guild, role };
    },
    async condition(ctx) {
        const { match, identity, guildId } = ctx;
        const guild = match.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.RoleDelete, match.role.id);
        if (!executor) return true;
        ctx.executorId = executor.executorId;

        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        const roleIds = executorMember ? [...executorMember.roles.cache.keys()] : [];
        if (guardConfigRepo.isWhitelisted(guildId, identity.key, executor.executorId, roleIds)) return true;

        const settings = tracker.getSettings(guildId, identity.key);
        ctx.settings = settings;

        const count = tracker.recordAction(guildId, identity.key, executor.executorId, settings);
        return count < settings.maxActions;
    },
    async punish(ctx) {
        await tracker.triggerAntiDown(ctx, "suppressions de rôles en rafale");
    },
};
