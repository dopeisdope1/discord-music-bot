"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

// GuildMemberRemove fires identically for a voluntary leave and a kick — discord.js
// gives no flag distinguishing the two on the event itself. The matcher always
// fires; condition() resolves the audit log to tell them apart: if no MemberKick
// entry targeting this member exists within resolveExecutor's recency window,
// it was a voluntary leave and we fail open (never punish blind).
//
// Important limitation: unlike other guards, punish() here cannot revert the
// action — Discord has no "un-kick" API. The only response available is
// punishing the unauthorized kicker via the configured punition; the kicked
// member is not restored.
module.exports = {
    key: "antikick",
    discordEvent: Events.GuildMemberRemove,
    async matcher(member) {
        if (!member.guild) return null;
        return {
            guildId: member.guild.id,
            client: member.client,
            member,
            description: `${member.user?.tag ?? member.id} a quitté le serveur / a été expulsé`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.member.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.MemberKick, match.member.id);
        if (!executor) return true; // no matching kick entry -> voluntary leave, fail open

        ctx.executorId = executor.executorId;
        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;
        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, executor.executorId, [])) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        if (executorMember && resolvePermission(executorMember) >= LEVEL.ADMIN) return true;

        return false;
    },
    async punish(ctx) {
        // No un-kick API exists — this only punishes the unauthorized kicker,
        // it cannot bring the expelled member back.
        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: ctx.match.member.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antikick: expulsion non autorisée",
                })
                .catch(() => {});
        }
    },
};
