"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "mv",
    category: "voice",
    description: "Déplace un utilisateur vers votre salon.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const channel = ctx.member.voice.channel;
        if (!channel) throw new BotError("Rejoins d'abord un salon vocal.");

        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("mv @user");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");
        if (!target.voice.channel) throw new BotError("Ce membre n'est dans aucun salon vocal.");

        await target.voice.setChannel(channel);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "➡️ Déplacement",
                    description: `${target} a été déplacé dans ${channel}.`,
                }),
            ],
        });
    },
};
