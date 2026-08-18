"use strict";

const { ChannelType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "voicemove",
    category: "gestion",
    description: "Déplace tous les membres en vocal dans un salon.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const id = extractChannelId(ctx.args[0]);
        if (!id) throw new UsageError("voicemove #salon-cible");

        const target = ctx.guild.channels.cache.get(id);
        if (!target || target.type !== ChannelType.GuildVoice) {
            throw new BotError("Le salon cible doit être un salon vocal existant.");
        }

        const source = ctx.member.voice.channel;
        if (!source) {
            throw new UsageError("Rejoins un salon vocal puis fais voicemove #salon-cible");
        }

        const members = [...source.members.values()];
        await Promise.all(members.map((member) => member.voice.setChannel(target).catch(() => {})));

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔀 Membres déplacés",
                    description: `${members.length} membre(s) déplacé(s) de ${source} vers ${target}.`,
                }),
            ],
        });
    },
};
