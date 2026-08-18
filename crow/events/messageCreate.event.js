"use strict";

const { Events } = require("discord.js");
const messageRouter = require("../core/messageRouter");
const customCommandRepo = require("../db/repositories/customCommandRepo");
const afkRepo = require("../db/repositories/afkRepo");

module.exports = {
    name: Events.MessageCreate,
    async execute(client, identity, message) {
        if (message.author.bot || !message.guild) return;

        const afk = afkRepo.get(message.guild.id, message.author.id);
        if (afk) {
            afkRepo.remove(message.guild.id, message.author.id);
            message.reply("👋 Bon retour, ton statut AFK a été retiré.").catch(() => {});
        }

        for (const mentioned of message.mentions.users.values()) {
            const targetAfk = afkRepo.get(message.guild.id, mentioned.id);
            if (targetAfk) {
                message
                    .reply(`💤 ${mentioned.username} est AFK : ${targetAfk.reason || "Aucune raison"}`)
                    .catch(() => {});
            }
        }

        const handled = await messageRouter.handleMessage(client, identity, message);
        if (handled) return;

        const prefix = messageRouter.resolvePrefix(identity, message.guild.id);
        if (!message.content.startsWith(prefix)) return;

        const name = message.content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
        if (!name) return;

        const custom = customCommandRepo.get(message.guild.id, name);
        if (custom) await message.channel.send(custom.response).catch(() => {});
    },
};
