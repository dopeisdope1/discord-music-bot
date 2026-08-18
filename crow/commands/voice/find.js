"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "find",
    category: "voice",
    description: "Indique dans quel salon vocal se trouve un utilisateur.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("find @user");

        const member = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!member) throw new BotError("Membre introuvable sur ce serveur.");

        const channel = member.voice.channel;
        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔎 Recherche vocale",
                    description: channel
                        ? `${member} se trouve dans ${channel}.`
                        : "Ce membre n'est dans aucun salon vocal.",
                }),
            ],
        });
    },
};
