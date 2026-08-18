"use strict";

const { loadCommandsForIdentity } = require("./commandLoader");
const { buildContext } = require("./commandContext");
const guildSettingsRepo = require("../db/repositories/guildSettingsRepo");
const { UsageError, PermissionError, BotError } = require("./errors");
const logger = require("./logger");

const registryCache = new Map(); // identityKey -> Map(commandName -> command)

function getRegistry(identity) {
    if (!registryCache.has(identity.key)) {
        registryCache.set(identity.key, loadCommandsForIdentity(identity));
    }
    return registryCache.get(identity.key);
}

function invalidateRegistryCache() {
    registryCache.clear();
}

function resolvePrefix(identity, guildId) {
    if (!guildId) return identity.defaultPrefix;
    const settings = guildSettingsRepo.getSettings(guildId, identity.key);
    return settings?.prefix || identity.defaultPrefix;
}

// Returns true when a built-in command was matched (regardless of whether it
// succeeded), so callers can fall through to e.g. custom-command lookup.
async function handleMessage(client, identity, message) {
    if (message.author.bot) return false;
    if (!message.guild) return false; // this suite is guild-only, no DM commands

    const prefix = resolvePrefix(identity, message.guild.id);
    if (!message.content.startsWith(prefix)) return false;

    const withoutPrefix = message.content.slice(prefix.length).trim();
    if (!withoutPrefix) return false;

    const args = withoutPrefix.split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const registry = getRegistry(identity);
    const command = registry.get(commandName);
    if (!command) return false;

    const ctx = buildContext({ message, args, client, identity });

    const requiredLevel = command.permLevel ?? 0;
    if (!ctx.botOwner && ctx.permLevel < requiredLevel) {
        await ctx.reply("❌ Tu n'as pas la permission d'utiliser cette commande.");
        return true;
    }

    try {
        await command.execute(ctx);
    } catch (error) {
        if (error instanceof UsageError) {
            await ctx.reply(`❌ Utilisation : ${error.message}`);
        } else if (error instanceof PermissionError) {
            await ctx.reply(`❌ ${error.message}`);
        } else if (error instanceof BotError) {
            await ctx.reply(`❌ ${error.message}`);
        } else {
            logger.error(identity.key, message.guild.id, `command "${commandName}" failed:`, error);
            await ctx.reply("❌ Une erreur inattendue est survenue.");
        }
    }

    return true;
}

module.exports = { handleMessage, invalidateRegistryCache, resolvePrefix };
