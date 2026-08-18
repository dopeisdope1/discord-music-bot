"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "topic",
    category: "gestion",
    description: "Modifie la description/sujet du salon.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const text = ctx.args.join(" ").trim();
        if (!text) throw new UsageError("topic [texte]");

        try {
            await ctx.message.channel.setTopic(text);
        } catch (error) {
            throw new BotError(`Impossible de modifier le sujet : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📝 Sujet mis à jour",
                    description: `Le sujet du salon est désormais : ${text}`,
                }),
            ],
        });
    },
};
