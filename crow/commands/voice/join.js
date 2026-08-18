"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "join",
    category: "voice",
    description: "Te déplace dans le salon vocal d'un utilisateur.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        // Discord only allows moving a member who is already connected to
        // voice, and moving "yourself" via voice.setChannel still requires
        // you to already be connected.
        if (!ctx.member.voice.channel) throw new BotError("Rejoins d'abord un salon vocal.");

        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("join @user");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");
        if (!target.voice.channel) throw new BotError("Ce membre n'est dans aucun salon vocal.");

        await ctx.member.voice.setChannel(target.voice.channel);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "➡️ Déplacement",
                    description: `Tu as rejoint ${target.voice.channel}.`,
                }),
            ],
        });
    },
};
