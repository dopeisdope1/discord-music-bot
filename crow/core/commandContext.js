"use strict";

const { EmbedBuilder } = require("discord.js");
const { getDb } = require("../db/connection");
const { resolvePermission } = require("./permissions/resolvePermission");
const guildSettingsRepo = require("../db/repositories/guildSettingsRepo");

function isBotOwner(userId) {
    const ids = (process.env.BOT_OWNER_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return ids.includes(userId);
}

// Built once per incoming command and passed to command.execute(ctx). Commands
// should stay thin controllers — real logic belongs in services/* and
// db/repositories/* so it can be reused across identities that share a command.
function buildContext({ message, args, client, identity }) {
    const db = getDb();
    const guildId = message.guild?.id ?? null;
    const settings = guildId ? guildSettingsRepo.getSettings(guildId, identity.key) : null;
    const themeColor = settings?.theme_color || identity.themeColor;
    const permLevel = message.member ? resolvePermission(message.member) : 0;

    return {
        message,
        args,
        client,
        identity,
        db,
        guildId,
        guild: message.guild,
        member: message.member,
        author: message.author,
        settings,
        permLevel,
        botOwner: isBotOwner(message.author.id),
        reply: (content) =>
            message.reply(typeof content === "string" ? { content } : content).catch(() => null),
        send: (content) =>
            message.channel.send(typeof content === "string" ? { content } : content).catch(() => null),
        embed: (opts = {}) => {
            const e = new EmbedBuilder().setColor(opts.color || themeColor || "#5865F2");
            if (opts.title) e.setTitle(opts.title);
            if (opts.description) e.setDescription(opts.description);
            if (opts.fields) e.addFields(opts.fields);
            e.setFooter({ text: opts.footer || identity.displayName });
            if (opts.timestamp !== false) e.setTimestamp();
            return e;
        },
    };
}

module.exports = { buildContext, isBotOwner };
