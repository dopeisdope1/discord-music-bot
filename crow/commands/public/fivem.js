"use strict";

const fivemProvider = require("../../services/externalApis/fivemProvider");
const { UsageError } = require("../../core/errors");

module.exports = {
    name: "fivem",
    category: "public",
    description: "Affiche le statut d'un serveur FiveM.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const target = ctx.args[0];
        if (!target || !target.includes(":")) throw new UsageError("fivem <host:port>");

        const [host, port] = target.split(":");
        if (!host || !port) throw new UsageError("fivem <host:port>");

        const status = await fivemProvider.getStatus(host, port);

        if (!status.online) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🔴 Hors ligne",
                        description: `Impossible de joindre le serveur FiveM \`${host}:${port}\`.`,
                    }),
                ],
            });
            return;
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `🟢 ${status.hostname || "Serveur FiveM"}`,
                    fields: [
                        { name: "Carte", value: status.mapname || "Inconnue", inline: true },
                        { name: "Mode", value: status.gametype || "Inconnu", inline: true },
                        {
                            name: "Joueurs",
                            value: `${status.clients ?? status.players.length}/${status.maxClients ?? "?"}`,
                            inline: true,
                        },
                    ],
                }),
            ],
        });
    },
};
