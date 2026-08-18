"use strict";

const guardConfigRepo = require("../db/repositories/guardConfigRepo");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");
const logger = require("../core/logger");

const definitions = [];

/**
 * Guard definition contract (one file per guard under guard/definitions/):
 *   key            - matches the guard_key stored in guard_config, e.g. "antirole"
 *   discordEvent   - a discord.js Client event name, e.g. "guildMemberUpdate"
 *   matcher(...eventArgs) -> { guildId, client, description, ...extra } | null
 *                    Pure-ish, cheap. Return null/falsy to skip this event entirely.
 *   condition(ctx) -> boolean | Promise<boolean>
 *                    Return true when the action was AUTHORIZED (no-op case, the
 *                    common path). Return false to trigger punish()/logEvent().
 *                    May be omitted if the guard has no authorized-actor concept.
 *   punish(ctx)    -> revert the change / apply the configured punition.
 *   logEvent(ctx)  -> optional; defaults to logsConfigRepo.postGuardLog(ctx).
 */
function register(def) {
    if (!def || !def.key || !def.discordEvent || typeof def.matcher !== "function") {
        throw new Error("guardEngine.register: invalid guard definition");
    }
    definitions.push(def);
}

function definitionsFor(discordEvent) {
    return definitions.filter((d) => d.discordEvent === discordEvent);
}

function attach(client, identity) {
    const events = [...new Set(definitions.map((d) => d.discordEvent))];

    for (const eventName of events) {
        client.on(eventName, async (...args) => {
            for (const def of definitionsFor(eventName)) {
                try {
                    await runDefinition(client, def, identity, args);
                } catch (error) {
                    logger.error(identity.key, null, `guard "${def.key}" crashed:`, error);
                }
            }
        });
    }
}

async function runDefinition(client, def, identity, eventArgs) {
    const match = await def.matcher(...eventArgs);
    if (!match || !match.guildId) return;

    const config = guardConfigRepo.getConfig(match.guildId, identity.key, def.key);
    if (!config || !config.enabled) return;

    const ctx = { client, identity, def, guildId: match.guildId, match, config };

    const authorized = def.condition ? await def.condition(ctx) : false;
    if (authorized) return;

    if (def.punish) await def.punish(ctx);

    if (def.logEvent) await def.logEvent(ctx);
    else await logsConfigRepo.postGuardLog(ctx);
}

module.exports = { register, attach, definitions };
