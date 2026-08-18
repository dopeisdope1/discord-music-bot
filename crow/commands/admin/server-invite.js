"use strict";

const { ChannelType, PermissionsBitField } = require("discord.js");
const { UsageError, BotError, PermissionError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "server-invite",
    category: "admin",
    description: "Génère un lien d'invitation pour un serveur.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        if (!ctx.botOwner) throw new PermissionError("Réservé aux propriétaires du bot.");

        const guildId = ctx.args[0];
        if (!guildId) throw new UsageError("server-invite [ID]");

        const guild = ctx.client.guilds.cache.get(guildId);
        if (!guild) throw new BotError("Serveur introuvable.");

        const channel = guild.channels.cache.find(
            (c) =>
                c.type === ChannelType.GuildText &&
                c.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.CreateInstantInvite)
        );
        if (!channel) throw new BotError("Aucun salon disponible pour créer une invitation.");

        const invite = await channel.createInvite({ maxAge: 3600 }).catch(() => null);
        if (!invite) throw new BotError("Impossible de créer une invitation pour ce serveur.");

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔗 Invitation générée",
                    description: `**${guild.name}** : ${invite.url}\n(expire dans 1h)`,
                }),
            ],
        });
    },
};
