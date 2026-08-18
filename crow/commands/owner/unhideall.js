"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "unhideall",
    category: "owner",
    description: "Démasque tous les salons textuels.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channels = ctx.guild.channels.cache.filter((c) => c.isTextBased() && !c.isVoiceBased());

        let success = 0;
        let fail = 0;
        for (const channel of channels.values()) {
            try {
                await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { ViewChannel: null });
                success++;
            } catch {
                fail++;
            }
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "👁️ Salons démasqués",
                    description: `${success} salon(s) démasqué(s).${fail ? ` (${fail} échec(s))` : ""}`,
                }),
            ],
        });
    },
};
