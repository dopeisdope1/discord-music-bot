"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "pvdelete",
    category: "voice",
    description: "Supprime tous les salons privés du serveur.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channels = voiceRepo.listByGuild(ctx.guildId).filter((c) => !c.is_temp);

        let count = 0;
        for (const info of channels) {
            const channel = ctx.guild.channels.cache.get(info.channel_id);
            if (channel) await channel.delete("Purge des salons privés").catch(() => {});
            voiceRepo.deleteChannel(info.channel_id);
            count++;
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🧹 Salons privés supprimés",
                    description: `${count} salon(s) supprimé(s).`,
                }),
            ],
        });
    },
};
