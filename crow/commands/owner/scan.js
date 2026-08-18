"use strict";

const { PermissionsBitField } = require("discord.js");
const { LEVEL } = require("../../core/permissions/permissionLevels");

const DANGEROUS_EVERYONE_FLAGS = ["Administrator", "ManageGuild", "BanMembers", "KickMembers", "ManageRoles"];

module.exports = {
    name: "scan",
    category: "owner",
    description: "Scanne le serveur à la recherche de failles.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        await ctx.guild.members.fetch().catch(() => {});

        const issues = [];

        const adminRoles = ctx.guild.roles.cache.filter(
            (r) => r.id !== ctx.guild.id && r.permissions.has(PermissionsBitField.Flags.Administrator)
        );
        if (adminRoles.size > 0) {
            issues.push(
                `⚠️ **${adminRoles.size} rôle(s)** possèdent la permission **Administrateur** : ${adminRoles.map((r) => r.toString()).join(", ")}`
            );
        }

        const everyone = ctx.guild.roles.everyone;
        const everyoneDangerous = DANGEROUS_EVERYONE_FLAGS.filter((flag) => everyone.permissions.has(PermissionsBitField.Flags[flag]));
        if (everyoneDangerous.length) {
            issues.push(`🚨 Le rôle **@everyone** possède des permissions dangereuses : ${everyoneDangerous.join(", ")}`);
        }

        const adminBots = ctx.guild.members.cache.filter((m) => m.user.bot && m.permissions.has(PermissionsBitField.Flags.Administrator));
        if (adminBots.size > 0) {
            issues.push(
                `🤖 **${adminBots.size} bot(s)** possèdent la permission **Administrateur** : ${adminBots.map((m) => m.toString()).join(", ")}`
            );
        }

        const adminMembers = ctx.guild.members.cache.filter((m) => m.permissions.has(PermissionsBitField.Flags.Administrator));

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔍 Scan de sécurité",
                    description: issues.length ? issues.join("\n\n") : "✅ Aucune faille évidente détectée.",
                    fields: [{ name: "Membres avec permission Administrateur", value: `${adminMembers.size}`, inline: true }],
                }),
            ],
        });
    },
};
