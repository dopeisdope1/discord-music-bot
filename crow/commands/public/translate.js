"use strict";

const translateProvider = require("../../services/externalApis/translateProvider");
const { UsageError } = require("../../core/errors");

module.exports = {
    name: "translate",
    category: "public",
    description: "Traduit un texte.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const targetLang = ctx.args[0];
        const text = ctx.args.slice(1).join(" ");
        if (!targetLang || !text) throw new UsageError("translate <code_lang> <texte>");

        // translateProvider.translate currently always throws NotConfiguredError
        // (no API key/provider wired yet, intentionally). Let it propagate — the
        // router renders NotConfiguredError like any other BotError.
        const result = await translateProvider.translate(text, targetLang);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🌐 Traduction",
                    fields: [
                        { name: "Texte original", value: text.slice(0, 1024) },
                        { name: `Traduction (${targetLang})`, value: String(result).slice(0, 1024) },
                    ],
                }),
            ],
        });
    },
};
