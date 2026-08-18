"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError } = require("../../core/errors");

module.exports = {
    name: "pv",
    category: "voice",
    description: "Transforme le salon vocal actuel en salon privé.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const channel = ctx.member.voice.channel;
        if (!channel) throw new UsageError("Rejoins d'abord un salon vocal.");

        const info = voiceRepo.getChannel(channel.id);
        if (!info) {
            voiceRepo.createChannel({
                channelId: channel.id,
                guildId: ctx.guildId,
                ownerId: ctx.author.id,
                isTemp: false,
            });
        }

        await channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { Connect: false });
        voiceRepo.setLocked(channel.id, true);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔒 Salon privé",
                    description: `${channel} est désormais un salon privé. Utilise \`acces add @user\` pour autoriser du monde.`,
                }),
            ],
        });
    },
};
