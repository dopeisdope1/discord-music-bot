"use strict";

const { Events } = require("discord.js");
const snipeCache = require("../utils/snipeCache");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.MessageDelete,
    async execute(client, identity, message) {
        if (message.author?.bot) return;
        snipeCache.recordDeleted(message);

        if (identity.key === "crowall" && message.guild) {
            await logsConfigRepo.postLog(client, identity, message.guild.id, "messages", {
                title: "🗑️ Message supprimé",
                color: "#ED4245",
                fields: [
                    { name: "Auteur", value: message.author ? `${message.author.tag} (${message.author.id})` : "Inconnu" },
                    { name: "Salon", value: `${message.channel}` },
                    { name: "Contenu", value: message.content?.slice(0, 1000) || "*(aucun contenu texte)*" },
                ],
            });
        }
    },
};
