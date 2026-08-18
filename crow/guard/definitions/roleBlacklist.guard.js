"use strict";

const { Events } = require("discord.js");
const moderationService = require("../../services/moderationService");
const blacklistRepo = require("../../db/repositories/blacklistRepo");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");

function diffAddedRoles(oldMember, newMember) {
    return [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles.cache.has(id));
}

// No authorized-actor concept here: it doesn't matter WHO granted the role, only
// that the recipient is on the role-blacklist. Strip it back off immediately.
module.exports = {
    key: "roleBlacklist",
    discordEvent: Events.GuildMemberUpdate,
    async matcher(oldMember, newMember) {
        const added = diffAddedRoles(oldMember, newMember);
        if (added.length === 0) return null;
        return {
            guildId: newMember.guild.id,
            client: newMember.client,
            member: newMember,
            addedRoleIds: added,
            description: `Rôle(s) ajouté(s) à ${newMember.user.tag} (utilisateur blacklisté)`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;

        if (!blacklistRepo.roleBlacklistIs(ctx.guildId, match.member.id)) return true; // not blacklisted, no-op

        const watched = blacklistRepo.specialRoleList(ctx.guildId, identity.key);
        if (watched.length && !match.addedRoleIds.some((id) => watched.includes(id))) return true; // non-special role, no-op

        return false;
    },
    async punish(ctx) {
        const { match } = ctx;
        await moderationService.revertRoleGrant({
            member: match.member,
            roleIds: match.addedRoleIds,
            reason: "Garde roleBlacklist: utilisateur blacklisté",
        });
    },
    async logEvent(ctx) {
        await logsConfigRepo.postLog(ctx.client, ctx.identity, ctx.guildId, "blr", {
            title: "🚫 BLR: attribution de rôle spécial bloquée",
            color: "#ED4245",
            fields: [
                { name: "Membre", value: `${ctx.match.member} (${ctx.match.member.id})` },
                { name: "Rôle(s) retiré(s)", value: ctx.match.addedRoleIds.map((id) => `<@&${id}>`).join(", ") },
            ],
        });
    },
};
