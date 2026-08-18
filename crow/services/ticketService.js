"use strict";

const { ChannelType, PermissionsBitField } = require("discord.js");
const ticketRepo = require("../db/repositories/ticketRepo");
const { BotError } = require("../core/errors");

async function createTicket(guild, opener) {
    const config = ticketRepo.getConfig(guild.id);
    if (!config || !config.category_id) {
        throw new BotError("Le système de tickets n'est pas configuré (voir `ticket`).");
    }

    const number = ticketRepo.nextTicketNumber(guild.id);

    const overwrites = [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
            id: opener.id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
            ],
        },
        {
            id: guild.client.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        },
    ];

    if (config.staff_role_id) {
        overwrites.push({
            id: config.staff_role_id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
            ],
        });
    }

    const channel = await guild.channels.create({
        name: `ticket-${number}`,
        type: ChannelType.GuildText,
        parent: config.category_id,
        permissionOverwrites: overwrites,
    });

    ticketRepo.create({ guildId: guild.id, channelId: channel.id, openerId: opener.id });
    return channel;
}

// Minimal viable transcript: plain-text lines fetched from the last 100
// messages, not a rendered HTML viewer.
async function closeTicket(channel, closer) {
    const ticket = ticketRepo.getByChannel(channel.id);
    if (!ticket) throw new BotError("Ce salon n'est pas un ticket.");

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => new Map());
    const transcript = [...messages.values()]
        .reverse()
        .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
        .join("\n");

    ticketRepo.close(ticket.id, transcript.slice(0, 100_000));
    await channel.delete(`Ticket fermé par ${closer.tag}`).catch(() => {});
    return transcript;
}

function claimTicket(channel, staff) {
    const ticket = ticketRepo.getByChannel(channel.id);
    if (!ticket) throw new BotError("Ce salon n'est pas un ticket.");
    ticketRepo.claim(ticket.id, staff.id);
}

module.exports = { createTicket, closeTicket, claimTicket };
