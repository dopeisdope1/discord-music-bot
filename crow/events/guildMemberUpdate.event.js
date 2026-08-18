"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

// Plain factual audit trail of every role/boost change — distinct from the
// guard engine's own internal guildMemberUpdate listener, which only logs
// UNAUTHORIZED changes to the "raid" log type. This one logs everything.
module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(client, identity, oldMember, newMember) {
        if (identity.key !== "crowall") return;

        const addedRoles = [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles.cache.has(id));
        const removedRoles = [...oldMember.roles.cache.keys()].filter((id) => !newMember.roles.cache.has(id));

        if (addedRoles.length || removedRoles.length) {
            await logsConfigRepo.postLog(client, identity, newMember.guild.id, "roles", {
                title: "🎭 Rôles modifiés",
                color: "#5865F2",
                fields: [
                    { name: "Membre", value: `${newMember} (${newMember.id})` },
                    ...(addedRoles.length ? [{ name: "Ajoutés", value: addedRoles.map((id) => `<@&${id}>`).join(", ") }] : []),
                    ...(removedRoles.length ? [{ name: "Retirés", value: removedRoles.map((id) => `<@&${id}>`).join(", ") }] : []),
                ],
            });
        }

        const wasBoosting = Boolean(oldMember.premiumSinceTimestamp);
        const isBoosting = Boolean(newMember.premiumSinceTimestamp);
        if (wasBoosting !== isBoosting) {
            await logsConfigRepo.postLog(client, identity, newMember.guild.id, "boosts", {
                title: isBoosting ? "💎 Nouveau boost" : "💔 Boost retiré",
                color: isBoosting ? "#F47FFF" : "#99AAB5",
                fields: [{ name: "Membre", value: `${newMember} (${newMember.id})` }],
            });
        }
    },
};
