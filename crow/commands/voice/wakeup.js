"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "wakeup",
    category: "voice",
    description: "Réveille un membre en le déplaçant de salon en salon.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("wakeup @user");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");
        if (!target.voice.channel) throw new BotError("Ce membre n'est dans aucun salon vocal.");

        const originalChannelId = target.voice.channelId;
        const other = [...ctx.guild.channels.cache.values()].find(
            (c) => c.isVoiceBased() && c.id !== originalChannelId
        );
        if (!other) throw new BotError("Aucun autre salon vocal disponible pour réveiller ce membre.");

        try {
            await target.voice.setChannel(other);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await target.voice.setChannel(originalChannelId);
        } catch {
            throw new BotError("Impossible de déplacer ce membre (a-t-il quitté le vocal entre-temps ?).");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "⏰ Réveil", description: `${target} a été réveillé.` })],
        });
    },
};
