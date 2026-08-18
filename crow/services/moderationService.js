"use strict";

const sanctionsRepo = require("../db/repositories/sanctionsRepo");
const leashRepo = require("../db/repositories/leashRepo");
const permissionRepo = require("../db/repositories/permissionRepo");
const { BotError } = require("../core/errors");

// Single place every warn/mute/ban/guard-punish call goes through, guild-scoped
// so multiple Crow bots in one guild share one sanction ledger (see
// identities/crowgestion.identity.js for the rationale).

async function warn({ guild, target, moderator, identityKey, reason }) {
    return sanctionsRepo.addSanction({
        guildId: guild.id,
        targetId: target.id,
        type: "warn",
        reason,
        moderatorId: moderator.id,
        issuedByIdentity: identityKey,
    });
}

async function mute({ guild, target, moderator, identityKey, reason, durationMs }) {
    const roleId = sanctionsRepo.getMuteRole(guild.id);
    if (!roleId) {
        throw new BotError("Aucun rôle de mute configuré — utilise `setmute @role` d'abord.");
    }

    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) throw new BotError("Membre introuvable sur ce serveur.");

    try {
        await member.roles.add(roleId, reason || "Mute");
    } catch {
        throw new BotError("Impossible d'ajouter le rôle de mute (permissions ou hiérarchie de rôles).");
    }

    return sanctionsRepo.addSanction({
        guildId: guild.id,
        targetId: target.id,
        type: durationMs ? "tempmute" : "mute",
        reason,
        moderatorId: moderator.id,
        issuedByIdentity: identityKey,
        durationMs: durationMs || null,
        expiresAt: durationMs ? Date.now() + durationMs : null,
    });
}

async function unmute({ guild, target, moderator, identityKey, reason, force = false }) {
    if (!force) {
        const leash = leashRepo.get(guild.id, target.id);
        if (leash && leash.anti_unmute) {
            throw new BotError(
                "Ce membre est en laisse (anti-unmute actif) — retire la laisse (`laisse`) avant de démute, ou force l'action."
            );
        }
    }

    const roleId = sanctionsRepo.getMuteRole(guild.id);
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (roleId && member) {
        await member.roles.remove(roleId, reason || "Unmute").catch(() => {});
    }

    sanctionsRepo.deactivateAllOfType(guild.id, target.id, "mute");
    sanctionsRepo.deactivateAllOfType(guild.id, target.id, "tempmute");
}

async function unmuteAll({ guild, moderator, identityKey }) {
    const active = sanctionsRepo.listActiveMutes(guild.id);
    let count = 0;
    for (const s of active) {
        try {
            await unmute({ guild, target: { id: s.target_id }, moderator, identityKey, force: true });
            count++;
        } catch {
            // best-effort sweep, keep going
        }
    }
    return count;
}

async function kick({ guild, target, moderator, identityKey, reason }) {
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) throw new BotError("Membre introuvable sur ce serveur.");
    if (!member.kickable) throw new BotError("Ce membre ne peut pas être expulsé (hiérarchie de rôles).");

    await member.kick(reason || undefined);

    return sanctionsRepo.addSanction({
        guildId: guild.id,
        targetId: target.id,
        type: "kick",
        reason,
        moderatorId: moderator.id,
        issuedByIdentity: identityKey,
    });
}

async function ban({ guild, target, moderator, identityKey, reason, durationMs, deleteMessageSeconds = 0 }) {
    await guild.members.ban(target.id, { reason: reason || undefined, deleteMessageSeconds });

    return sanctionsRepo.addSanction({
        guildId: guild.id,
        targetId: target.id,
        type: durationMs ? "tempban" : "ban",
        reason,
        moderatorId: moderator.id,
        issuedByIdentity: identityKey,
        durationMs: durationMs || null,
        expiresAt: durationMs ? Date.now() + durationMs : null,
    });
}

async function unban({ guild, userId, reason }) {
    await guild.bans.remove(userId, reason || undefined);
    sanctionsRepo.deactivateAllOfType(guild.id, userId, "ban");
    sanctionsRepo.deactivateAllOfType(guild.id, userId, "tempban");
}

async function derank({ guild, target, moderator, identityKey, reason }) {
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) throw new BotError("Membre introuvable sur ce serveur.");

    const adminRoleIds = new Set(permissionRepo.listRoleIdsAtLevel(guild.id, 3));
    const toRemove = member.roles.cache.filter(
        (role) => role.id !== guild.id && (role.permissions.has("Administrator") || adminRoleIds.has(role.id))
    );

    for (const role of toRemove.values()) {
        await member.roles.remove(role, reason || "Derank").catch(() => {});
    }

    return sanctionsRepo.addSanction({
        guildId: guild.id,
        targetId: target.id,
        type: "derank",
        reason,
        moderatorId: moderator.id,
        issuedByIdentity: identityKey,
    });
}

// Reverts an unauthorized role grant — the shared punish() action for the
// antirole/secur guard definitions.
async function revertRoleGrant({ member, roleIds, reason }) {
    for (const roleId of roleIds) {
        await member.roles.remove(roleId, reason || "Garde: attribution de rôle non autorisée").catch(() => {});
    }
}

// Emergency de-arm used by the antidown guard: strips every non-managed role
// from a member whose action velocity tripped the anti-nuke threshold. Returns
// the removed role ids so the caller can optionally restore them later.
async function stripAllRoles(member, reason) {
    const removableRoleIds = [...member.roles.cache.values()]
        .filter((role) => role.id !== member.guild.id && !role.managed)
        .map((role) => role.id);

    if (removableRoleIds.length === 0) return [];

    await member.roles.remove(removableRoleIds, reason || "Garde antidown: neutralisation d'urgence").catch(() => {});
    return removableRoleIds;
}

async function restoreRoles(guild, memberId, roleIds, reason) {
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member || roleIds.length === 0) return;
    await member.roles.add(roleIds, reason || "Garde antidown: réactivation des permissions").catch(() => {});
}

// Applies a guard's configured default punition (kick/ban/mute) against a target,
// best-effort (guards must never throw past this point).
async function applyGuardPunition({ guild, target, identityKey, punition, reason }) {
    const botUser = guild.client.user;
    const moderator = { id: botUser.id };

    switch (punition) {
        case "ban":
            return ban({ guild, target, moderator, identityKey, reason }).catch(() => null);
        case "mute":
            return mute({ guild, target, moderator, identityKey, reason }).catch(() => null);
        case "kick":
        default:
            return kick({ guild, target, moderator, identityKey, reason }).catch(() => null);
    }
}

module.exports = {
    warn,
    mute,
    unmute,
    unmuteAll,
    kick,
    ban,
    unban,
    derank,
    revertRoleGrant,
    applyGuardPunition,
    stripAllRoles,
    restoreRoles,
};
