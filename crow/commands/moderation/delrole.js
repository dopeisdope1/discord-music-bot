"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId, extractRoleId } = require("../../utils/args");

module.exports = {
    name: "delrole",
    category: "moderation",
    description: "Retire un rôle à un utilisateur.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        const roleId = extractRoleId(ctx.args[1]);
        if (!targetId || !roleId) throw new UsageError("delrole @user @role");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        try {
            await target.roles.remove(role, `Retiré par ${ctx.author.tag}`);
        } catch {
            throw new BotError("Impossible de retirer ce rôle (hiérarchie de rôles ou permissions).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✅ Rôle retiré",
                    description: `${role} a été retiré de ${target}.`,
                }),
            ],
        });
    },
};
