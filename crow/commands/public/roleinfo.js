"use strict";

const { PermissionFlagsBits } = require("discord.js");
const { extractRoleId } = require("../../utils/args");
const { UsageError, BotError } = require("../../core/errors");

const KEY_PERMISSIONS = [
    ["Administrateur", PermissionFlagsBits.Administrator],
    ["Gérer le serveur", PermissionFlagsBits.ManageGuild],
    ["Bannir des membres", PermissionFlagsBits.BanMembers],
    ["Expulser des membres", PermissionFlagsBits.KickMembers],
    ["Gérer les rôles", PermissionFlagsBits.ManageRoles],
];

// Intentional duplicate of role-info.js under the alias name "roleinfo" (see
// command contract — the two are separate command NAMES, both registered so
// either spelling works without needing a cross-file require for ~15 lines).
module.exports = {
    name: "roleinfo",
    category: "public",
    description: "Affiche les informations d'un rôle.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const roleId = extractRoleId(ctx.args[0]);
        if (!roleId) throw new UsageError("roleinfo @role");

        const role = await ctx.guild.roles.fetch(roleId).catch(() => null);
        if (!role) throw new BotError("Rôle introuvable.");

        await ctx.guild.members.fetch().catch(() => {});

        const permsList = KEY_PERMISSIONS.map(
            ([label, flag]) => `${label} : ${role.permissions.has(flag) ? "Oui" : "Non"}`
        ).join("\n");

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `🎭 Rôle : ${role.name}`,
                    color: role.color || undefined,
                    fields: [
                        { name: "ID", value: role.id, inline: true },
                        { name: "Couleur", value: role.hexColor, inline: true },
                        { name: "Membres", value: `${role.members.size}`, inline: true },
                        { name: "Position", value: `${role.position}`, inline: true },
                        { name: "Mentionnable", value: role.mentionable ? "Oui" : "Non", inline: true },
                        { name: "Affiché séparément", value: role.hoist ? "Oui" : "Non", inline: true },
                        {
                            name: "Créé le",
                            value: `<t:${Math.floor(role.createdTimestamp / 1000)}:F>`,
                            inline: false,
                        },
                        { name: "Permissions clés", value: permsList, inline: false },
                    ],
                }),
            ],
        });
    },
};
