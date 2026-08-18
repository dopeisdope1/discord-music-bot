"use strict";

const { Events } = require("discord.js");
const snipeCache = require("../utils/snipeCache");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.MessageUpdate,
    async execute(client, identity, oldMessage, newMessage) {
        if (newMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;
        snipeCache.recordEdited(oldMessage, newMessage);

        if (identity.key === "crowall" && newMessage.guild) {
            await logsConfigRepo.postLog(client, identity, newMessage.guild.id, "messages", {
                title: "✏️ Message édité",
                color: "#FEE75C",
                fields: [
                    { name: "Auteur", value: `${newMessage.author.tag} (${newMessage.author.id})` },
                    { name: "Salon", value: `${newMessage.channel}` },
                    { name: "Avant", value: oldMessage.content?.slice(0, 500) || "*(vide)*" },
                    { name: "Après", value: newMessage.content?.slice(0, 500) || "*(vide)*" },
                ],
            });
        }
    },
};
