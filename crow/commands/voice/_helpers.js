"use strict";

// Shared helpers for src/commands/voice/*. Not a command file itself (no
// name/category/execute export), so the command loader skips it harmlessly.

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// The voice channel the author is currently sitting in, that they also own
// (Admin-tier members bypass the ownership check so staff can intervene).
function requireOwnedVoiceChannel(ctx) {
    const channel = ctx.member.voice.channel;
    if (!channel) throw new UsageError("Rejoins d'abord un salon vocal.");
    const info = voiceRepo.getChannel(channel.id);
    if (!info) throw new BotError("Ce salon vocal n'est pas géré par le bot.");
    if (info.owner_id !== ctx.author.id && ctx.permLevel < LEVEL.ADMIN) {
        throw new BotError("Tu n'es pas le propriétaire de ce salon vocal.");
    }
    return { channel, info };
}

module.exports = { requireOwnedVoiceChannel };
