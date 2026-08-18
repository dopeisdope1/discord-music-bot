"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId, extractRoleId } = require("../../utils/args");

module.exports = {
    name: "addrole",
    category: "moderation",
    description: "Attribue un rôle à un utilisateur.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        const roleId = extractRoleId(ctx.args[1]);
        if (!targetId || !roleId) throw new UsageError("addrole @user @role");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        try {
            await target.roles.add(role, `Ajouté par ${ctx.author.tag}`);
        } catch {
            throw new BotError("Impossible d'attribuer ce rôle (hiérarchie de rôles ou permissions).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✅ Rôle attribué",
                    description: `${role} a été attribué à ${target}.`,
                }),
            ],
        });
    },
};
