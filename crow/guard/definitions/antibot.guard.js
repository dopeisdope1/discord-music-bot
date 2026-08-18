"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    key: "antibot",
    discordEvent: Events.GuildMemberAdd,
    async matcher(member) {
        if (!member.user.bot) return null;
        return {
            guildId: member.guild.id,
            client: member.client,
            member,
            description: `Le bot ${member.user.tag} a rejoint le serveur`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.member.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.BotAdd, match.member.id);
        // A bot joining with no attributable inviter is treated as unauthorized —
        // unlike other guards this one fails CLOSED, since a bot join is always
        // attributable to an OAuth authorize action.
        if (!executor) return false;

        ctx.executorId = executor.executorId;
        if (executor.executorId === guild.ownerId) return true;
        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, match.member.id, [])) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        if (executorMember && resolvePermission(executorMember) >= LEVEL.ADMIN) return true;

        return false;
    },
    async punish(ctx) {
        const { match } = ctx;
        await match.member.kick("Garde antibot: bot ajouté sans autorisation").catch(() => {});

        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: match.member.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antibot: a ajouté un bot non autorisé",
                })
                .catch(() => {});
        }
    },
};
