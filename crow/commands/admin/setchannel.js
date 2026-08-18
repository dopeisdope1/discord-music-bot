"use strict";

const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "setchannel",
    category: "admin",
    description: "Fixe le salon où exécuter les commandes de modération.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("setchannel #salon");

        ctx.db
            .prepare(
                `INSERT INTO mod_channel (guild_id, channel_id) VALUES (?, ?)
                 ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id`
            )
            .run(ctx.guildId, channelId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📌 Salon de modération",
                    description: `Les commandes de modération s'exécuteront désormais dans <#${channelId}>.`,
                }),
            ],
        });
    },
};
