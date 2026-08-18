"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "hideall",
    category: "owner",
    description: "Masque tous les salons textuels.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channels = ctx.guild.channels.cache.filter((c) => c.isTextBased() && !c.isVoiceBased());

        let success = 0;
        let fail = 0;
        for (const channel of channels.values()) {
            try {
                await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { ViewChannel: false });
                success++;
            } catch {
                fail++;
            }
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🙈 Salons masqués",
                    description: `${success} salon(s) masqué(s) pour @everyone.${fail ? ` (${fail} échec(s))` : ""}`,
                }),
            ],
        });
    },
};
