"use strict";

module.exports = {
    name: "serverinfo",
    category: "public",
    description: "Affiche les statistiques et infos du serveur.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const guild = ctx.guild;
        await guild.members.fetch().catch(() => {});
        const owner = await guild.fetchOwner().catch(() => null);

        const channels = guild.channels.cache;
        const textChannels = channels.filter((c) => c.isTextBased() && !c.isVoiceBased()).size;
        const voiceChannels = channels.filter((c) => c.isVoiceBased()).size;

        await ctx.reply({
            embeds: [
                ctx
                    .embed({
                        title: `🏰 ${guild.name}`,
                        fields: [
                            { name: "ID", value: guild.id, inline: true },
                            { name: "Propriétaire", value: owner ? owner.user.tag : "Inconnu", inline: true },
                            { name: "Membres", value: `${guild.memberCount}`, inline: true },
                            { name: "Salons texte", value: `${textChannels}`, inline: true },
                            { name: "Salons vocaux", value: `${voiceChannels}`, inline: true },
                            { name: "Rôles", value: `${guild.roles.cache.size}`, inline: true },
                            { name: "Niveau de boost", value: `${guild.premiumTier ?? 0}`, inline: true },
                            { name: "Boosts", value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
                            {
                                name: "Créé le",
                                value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
                                inline: true,
                            },
                        ],
                    })
                    .setThumbnail(guild.iconURL({ size: 1024 }) || null),
            ],
        });
    },
};
