"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "vclear",
    category: "voice",
    description: "Purge toutes les configurations d'un type.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const type = (ctx.args[0] || "").toLowerCase();
        if (!["config", "channels", "bans"].includes(type)) {
            throw new UsageError("vclear <config|channels|bans>");
        }

        if (type === "config") {
            voiceRepo.clearConfig(ctx.guildId);
            await ctx.reply({
                embeds: [ctx.embed({ title: "🧹 Configuration vocale réinitialisée" })],
            });
            return;
        }

        if (type === "channels") {
            const channels = voiceRepo.listByGuild(ctx.guildId);
            let count = 0;
            for (const info of channels) {
                const channel = ctx.guild.channels.cache.get(info.channel_id);
                if (channel) await channel.delete("Purge des salons vocaux").catch(() => {});
                voiceRepo.deleteChannel(info.channel_id);
                count++;
            }
            await ctx.reply({
                embeds: [
                    ctx.embed({ title: "🧹 Salons vocaux purgés", description: `${count} salon(s) supprimé(s).` }),
                ],
            });
            return;
        }

        // type === "bans"
        const count = voiceRepo.resetAllBans(ctx.guildId);
        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🧹 Blacklists vocales réinitialisées",
                    description: `${count} bannissement(s) supprimé(s).`,
                }),
            ],
        });
    },
};
