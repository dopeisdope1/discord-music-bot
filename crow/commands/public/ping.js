"use strict";

module.exports = {
    name: "ping",
    category: "public",
    description: "Affiche la latence du bot.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const sent = await ctx.reply("🏓 Calcul...");
        if (!sent) return;

        const rtt = sent.createdTimestamp - ctx.message.createdTimestamp;
        await sent.edit(`🏓 Pong ! Latence : ${rtt}ms | API : ${Math.round(ctx.client.ws.ping)}ms`).catch(() => {});
    },
};
