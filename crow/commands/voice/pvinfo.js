"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError, BotError } = require("../../core/errors");

module.exports = {
    name: "pvinfo",
    category: "voice",
    description: "Affiche les détails de votre salon privé.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const channel = ctx.member.voice.channel;
        if (!channel) throw new UsageError("Rejoins d'abord un salon vocal.");

        // Anyone in the channel can view its info — only mutating commands
        // (acces, etc.) require ownership.
        const info = voiceRepo.getChannel(channel.id);
        if (!info) throw new BotError("Ce salon vocal n'est pas géré par le bot.");

        const access = voiceRepo.listAccess(channel.id);
        const allowed = access.filter((a) => a.mode === "allow").map((a) => `<@${a.user_id}>`);
        const denied = access.filter((a) => a.mode === "deny").map((a) => `<@${a.user_id}>`);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `ℹ️ Informations — ${channel.name}`,
                    fields: [
                        { name: "Propriétaire", value: `<@${info.owner_id}>`, inline: true },
                        { name: "Verrouillé", value: info.locked ? "Oui" : "Non", inline: true },
                        {
                            name: "Limite d'utilisateurs",
                            value: info.user_limit ? String(info.user_limit) : "Aucune",
                            inline: true,
                        },
                        { name: "Accès autorisé", value: allowed.length ? allowed.join(", ") : "Aucun" },
                        { name: "Accès refusé", value: denied.length ? denied.join(", ") : "Aucun" },
                    ],
                }),
            ],
        });
    },
};
