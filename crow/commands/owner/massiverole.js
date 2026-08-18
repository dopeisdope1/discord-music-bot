"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractRoleId } = require("../../utils/args");

module.exports = {
    name: "massiverole",
    category: "owner",
    description: "Attribue ou retire un rôle à tous les membres en masse.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();
        const roleId = extractRoleId(ctx.args[1]);
        if (!["add", "remove"].includes(sub) || !roleId) {
            throw new UsageError("massiverole <add|remove> @role");
        }

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        await ctx.reply(
            `⏳ ${sub === "add" ? "Attribution" : "Retrait"} du rôle ${role} à tous les membres en cours… cela peut prendre du temps et heurter les limites de débit de Discord sur un serveur volumineux.`
        );

        await ctx.guild.members.fetch();

        let success = 0;
        let fail = 0;
        for (const member of ctx.guild.members.cache.values()) {
            try {
                if (sub === "add") await member.roles.add(role);
                else await member.roles.remove(role);
                success++;
            } catch {
                fail++;
            }
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: sub === "add" ? "✅ Attribution en masse terminée" : "✅ Retrait en masse terminé",
                    description: `${success} membre(s) traité(s) avec succès, ${fail} échec(s).`,
                }),
            ],
        });
    },
};
