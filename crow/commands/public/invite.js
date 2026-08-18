"use strict";

module.exports = {
    name: "invite",
    category: "public",
    description: "Fournit le lien d'invitation du bot.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${ctx.client.user.id}&permissions=8&scope=bot`;

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔗 Inviter le bot",
                    description: `[Clique ici pour inviter ${ctx.identity.displayName}](${url})`,
                    footer: "Permissions par défaut : Administrateur — les propriétaires de serveur devraient les ajuster.",
                }),
            ],
        });
    },
};
