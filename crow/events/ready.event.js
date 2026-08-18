"use strict";

const { Events } = require("discord.js");
const logger = require("../core/logger");
const giveawayService = require("../services/giveawayService");
const captchaService = require("../services/captchaService");
const sanctionsRepo = require("../db/repositories/sanctionsRepo");
const moderationService = require("../services/moderationService");

async function sweepExpiredSanctions(client, identity) {
    const expired = sanctionsRepo.getExpiringActive(Date.now());
    for (const s of expired) {
        const guild = client.guilds.cache.get(s.guild_id);
        if (!guild) continue; // only the client(s) actually in this guild can act on it

        try {
            if (s.type === "tempmute") {
                await moderationService.unmute({
                    guild,
                    target: { id: s.target_id },
                    moderator: { id: client.user.id },
                    identityKey: identity.key,
                    force: true,
                });
            } else if (s.type === "tempban") {
                await moderationService.unban({
                    guild,
                    userId: s.target_id,
                    reason: "Fin de bannissement temporaire",
                });
            } else {
                sanctionsRepo.deactivate(s.guild_id, s.id);
            }
        } catch {
            // leave active, retried on next sweep
        }
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client, identity) {
        logger.info(identity.key, null, `Connecté : ${client.user.tag}`);

        // Only one identity needs to drive these process-wide sweepers — crowall
        // owns giveaway + captcha (only identity with those categories enabled).
        if (identity.key === "crowall") {
            giveawayService.startSweeper(client);
            setInterval(() => captchaService.sweepExpired(client).catch(() => {}), 60_000);
        }

        setInterval(() => sweepExpiredSanctions(client, identity).catch(() => {}), 60_000);
    },
};
