"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

// Admin-forced lock/unlock — unlike `pv` (owner-only, permLevel 0), this works
// on any voice channel regardless of who owns it, tracked or not.
module.exports = {
    name: "vlock",
    category: "voice",
    description: "Bloque ou débloque un salon vocal.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        let channel = ctx.member.voice.channel;
        if (ctx.args[0]) {
            const id = extractChannelId(ctx.args[0]);
            channel = id ? ctx.guild.channels.cache.get(id) : null;
        }
        if (!channel || !channel.isVoiceBased()) {
            throw new BotError("Salon vocal introuvable. Rejoins un salon ou précise un salon valide.");
        }

        const everyone = ctx.guild.roles.everyone;
        const currentlyLocked = channel.permissionOverwrites.cache.get(everyone.id)?.deny.has("Connect") ?? false;

        await channel.permissionOverwrites.edit(everyone, { Connect: currentlyLocked ? null : false });

        const info = voiceRepo.getChannel(channel.id);
        if (info) voiceRepo.setLocked(channel.id, !currentlyLocked);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: currentlyLocked ? "🔓 Salon débloqué" : "🔒 Salon bloqué",
                    description: `${channel} est désormais ${currentlyLocked ? "débloqué" : "bloqué"}.`,
                }),
            ],
        });
    },
};
