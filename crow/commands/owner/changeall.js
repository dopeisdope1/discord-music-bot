"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "changeall",
    category: "owner",
    description: "Renomme tous les membres du serveur.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        // No name given -> reset everyone's nickname instead of requiring one.
        const name = ctx.args.join(" ") || null;

        await ctx.reply(
            `⏳ ${name ? `Renommage en "${name}"` : "Réinitialisation des pseudos"} de tous les membres en cours… cela peut prendre du temps sur un serveur volumineux.`
        );

        await ctx.guild.members.fetch();

        let success = 0;
        let fail = 0;
        for (const member of ctx.guild.members.cache.values()) {
            try {
                await member.setNickname(name);
                success++;
            } catch {
                // Can't rename the owner or members with a higher/equal role — skip silently.
                fail++;
            }
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✏️ Renommage en masse terminé",
                    description: `${success} membre(s) renommé(s), ${fail} échec(s) (hiérarchie de rôles, propriétaire du serveur, etc.).`,
                }),
            ],
        });
    },
};
