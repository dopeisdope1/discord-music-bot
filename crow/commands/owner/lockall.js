"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "lockall",
    category: "owner",
    description: "Verrouille l'accès en écriture à tous les salons.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channels = ctx.guild.channels.cache.filter((c) => c.isTextBased() && !c.isVoiceBased());

        let success = 0;
        let fail = 0;
        for (const channel of channels.values()) {
            try {
                await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: false });
                success++;
            } catch {
                fail++;
            }
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔒 Salons verrouillés",
                    description: `${success} salon(s) verrouillé(s).${fail ? ` (${fail} échec(s))` : ""}`,
                }),
            ],
        });
    },
};
