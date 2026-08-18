"use strict";

const { BotError } = require("../../core/errors");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "vocinfo",
    category: "voice",
    description: "Affiche les statistiques d'un salon vocal.",
    permLevel: 0,
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

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `🔊 ${channel.name}`,
                    fields: [
                        {
                            name: "Membres",
                            value: `${channel.members.size}${channel.userLimit ? `/${channel.userLimit}` : ""}`,
                            inline: true,
                        },
                        {
                            name: "Bitrate",
                            value: `${Math.round((channel.bitrate || 0) / 1000)} kbps`,
                            inline: true,
                        },
                        { name: "Région", value: channel.rtcRegion || "Automatique", inline: true },
                    ],
                }),
            ],
        });
    },
};
