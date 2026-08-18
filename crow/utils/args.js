"use strict";

function extractUserId(token) {
    if (!token) return null;
    const mentionMatch = token.match(/^<@!?(\d+)>$/);
    if (mentionMatch) return mentionMatch[1];
    if (/^\d{15,25}$/.test(token)) return token;
    return null;
}

function extractRoleId(token) {
    if (!token) return null;
    const mentionMatch = token.match(/^<@&(\d+)>$/);
    if (mentionMatch) return mentionMatch[1];
    if (/^\d{15,25}$/.test(token)) return token;
    return null;
}

function extractChannelId(token) {
    if (!token) return null;
    const mentionMatch = token.match(/^<#(\d+)>$/);
    if (mentionMatch) return mentionMatch[1];
    if (/^\d{15,25}$/.test(token)) return token;
    return null;
}

async function resolveMember(guild, token) {
    const id = extractUserId(token);
    if (!id) return null;
    return guild.members.fetch(id).catch(() => null);
}

module.exports = { extractUserId, extractRoleId, extractChannelId, resolveMember };
