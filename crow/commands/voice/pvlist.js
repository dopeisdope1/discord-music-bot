"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { paginate } = require("../../utils/pagination");

const PAGE_SIZE = 10;

module.exports = {
    name: "pvlist",
    category: "voice",
    description: "Affiche la liste des salons privés actifs.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const channels = voiceRepo.listByGuild(ctx.guildId).filter((c) => !c.is_temp);

        if (!channels.length) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Salons privés",
                        description: "Aucun salon privé actif sur ce serveur.",
                    }),
                ],
            });
            return;
        }

        const chunks = [];
        for (let i = 0; i < channels.length; i += PAGE_SIZE) chunks.push(channels.slice(i, i + PAGE_SIZE));

        const pages = chunks.map((chunk, pageIndex) => {
            const lines = chunk.map(
                (c) => `<#${c.channel_id}> — propriétaire <@${c.owner_id}>${c.locked ? " 🔒" : ""}`
            );
            return ctx.embed({
                title: `📋 Salons privés (page ${pageIndex + 1}/${chunks.length})`,
                description: lines.join("\n"),
            });
        });

        await paginate(ctx.message, pages);
    },
};
