"use strict";

// Ephemeral, in-memory, process-local caches for +snipe / +editsnipe — not
// persisted (matches how every prefix-bot implements snipe: last N seconds of
// memory, not a permanent record).
const MAX_PER_CHANNEL = 5;

const deleted = new Map(); // channelId -> [{content, authorTag, authorId, deletedAt}]
const edited = new Map(); // channelId -> [{before, after, authorTag, authorId, editedAt}]

function pushCapped(map, channelId, entry) {
    const list = map.get(channelId) || [];
    list.unshift(entry);
    if (list.length > MAX_PER_CHANNEL) list.length = MAX_PER_CHANNEL;
    map.set(channelId, list);
}

function recordDeleted(message) {
    if (!message.content && message.embeds.length === 0) return;
    pushCapped(deleted, message.channelId, {
        content: message.content,
        authorTag: message.author?.tag,
        authorId: message.author?.id,
        authorAvatar: message.author?.displayAvatarURL?.(),
        deletedAt: Date.now(),
    });
}

function recordEdited(oldMessage, newMessage) {
    if (oldMessage.content === newMessage.content) return;
    pushCapped(edited, newMessage.channelId, {
        before: oldMessage.content,
        after: newMessage.content,
        authorTag: newMessage.author?.tag,
        authorId: newMessage.author?.id,
        authorAvatar: newMessage.author?.displayAvatarURL?.(),
        editedAt: Date.now(),
    });
}

function getSnipe(channelId, index = 0) {
    return deleted.get(channelId)?.[index] || null;
}

function getEditSnipe(channelId, index = 0) {
    return edited.get(channelId)?.[index] || null;
}

module.exports = { recordDeleted, recordEdited, getSnipe, getEditSnipe };
