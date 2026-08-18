"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "rename",
    category: "gestion",
    description: "Renomme le salon actuel.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const name = ctx.args.join(" ").trim();
        if (!name) throw new UsageError("rename [nom]");

        try {
            await ctx.message.channel.setName(name);
        } catch (error) {
            throw new BotError(`Impossible de renommer ce salon : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✏️ Salon renommé",
                    description: `Ce salon s'appelle désormais **${name}**.`,
                }),
            ],
        });
    },
};
