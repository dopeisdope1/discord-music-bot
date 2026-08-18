"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "unlockall",
    category: "owner",
    description: "Déverrouille l'accès en écriture à tous les salons.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channels = ctx.guild.channels.cache.filter((c) => c.isTextBased() && !c.isVoiceBased());

        let success = 0;
        let fail = 0;
        for (const channel of channels.values()) {
            try {
                await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: null });
                success++;
            } catch {
                fail++;
            }
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔓 Salons déverrouillés",
                    description: `${success} salon(s) déverrouillé(s).${fail ? ` (${fail} échec(s))` : ""}`,
                }),
            ],
        });
    },
};
