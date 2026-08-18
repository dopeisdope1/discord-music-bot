"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const tracker = require("../antiDownTracker");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

// One of several definitions sharing guard_key "antidown" (see also
// antidown-role.guard.js) — they share one guard_config row and one velocity
// counter per executor via guard/antiDownTracker.js. Unlike the other guards,
// this one does NOT auto-exempt native ADMIN-permission members: the whole
// point of an anti-nuke breaker is to stop a compromised/malicious admin
// account too, not just non-admins. Only the bot itself, the guild owner, and
// explicitly bypass-listed roles/users are exempt.
module.exports = {
    key: "antidown",
    discordEvent: Events.ChannelDelete,
    async matcher(channel) {
        if (!channel.guild) return null;
        return { guildId: channel.guild.id, client: channel.client, guild: channel.guild, channel, categoryId: channel.parentId };
    },
    async condition(ctx) {
        const { match, identity, guildId } = ctx;
        const guild = match.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.ChannelDelete, match.channel.id);
        if (!executor) return true;
        ctx.executorId = executor.executorId;

        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        const roleIds = executorMember ? [...executorMember.roles.cache.keys()] : [];
        if (guardConfigRepo.isWhitelisted(guildId, identity.key, executor.executorId, roleIds)) return true;

        const settings = tracker.getSettings(guildId, identity.key);
        ctx.settings = settings;
        if (tracker.isCategoryBypassed(settings, match.categoryId)) return true;

        const count = tracker.recordAction(guildId, identity.key, executor.executorId, settings);
        return count < settings.maxActions;
    },
    async punish(ctx) {
        await tracker.triggerAntiDown(ctx, "suppressions de salons en rafale");
    },
};
