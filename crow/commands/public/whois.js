"use strict";

const { extractUserId } = require("../../utils/args");
const { BotError } = require("../../core/errors");

// Intentional duplicate of user.js under the alias name "whois" (same
// alias-pair pattern as role-info/roleinfo — separate command NAMES).
module.exports = {
    name: "whois",
    category: "public",
    description: "Affiche les informations détaillées d'un membre.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]) || ctx.author.id;
        const member = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!member) throw new BotError("Membre introuvable sur ce serveur.");

        const roles = member.roles.cache
            .filter((r) => r.id !== ctx.guild.id)
            .sort((a, b) => b.position - a.position)
            .map((r) => r.toString());

        const fields = [
            { name: "Tag", value: member.user.tag, inline: true },
            { name: "ID", value: member.id, inline: true },
            { name: "Pseudo", value: member.nickname || "Aucun", inline: true },
            {
                name: "Compte créé le",
                value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`,
                inline: false,
            },
            {
                name: "A rejoint le",
                value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Inconnu",
                inline: false,
            },
            {
                name: `Rôles (${roles.length})`,
                value: roles.length ? roles.join(" ").slice(0, 1024) : "Aucun",
                inline: false,
            },
        ];

        if (member.premiumSinceTimestamp) {
            fields.push({
                name: "Boost depuis",
                value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:F>`,
                inline: false,
            });
        }

        await ctx.reply({
            embeds: [
                ctx
                    .embed({ title: `👤 ${member.user.tag}`, fields })
                    .setThumbnail(member.user.displayAvatarURL({ size: 512 })),
            ],
        });
    },
};
