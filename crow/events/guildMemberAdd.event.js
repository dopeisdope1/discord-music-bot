"use strict";

const { Events } = require("discord.js");
const guardConfigRepo = require("../db/repositories/guardConfigRepo");
const captchaService = require("../services/captchaService");
const blacklistService = require("../services/blacklistService");
const guildSettingsRepo = require("../db/repositories/guildSettingsRepo");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(client, identity, member) {
        if (identity.key === "crowall") {
            await logsConfigRepo.postLog(client, identity, member.guild.id, member.user.bot ? "bots" : "join", {
                title: member.user.bot ? "🤖 Bot ajouté" : "👋 Nouveau membre",
                color: "#57F287",
                fields: [
                    { name: "Utilisateur", value: `${member} (${member.id})` },
                    { name: "Compte créé", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
                ],
            });
        }

        // CrowBL-style network auto-ban — only meaningful for identities
        // bundling the 'bl' category (currently crowgestion).
        const banned = await blacklistService.enforceOnJoin(member).catch(() => false);
        if (banned) return;

        // Minimum account age gate (CrowALL's `creation`).
        const minAge = guardConfigRepo.getAccountAgeRequirement(member.guild.id);
        if (minAge && Date.now() - member.user.createdTimestamp < minAge) {
            await member.kick("Compte trop récent (âge minimum requis non atteint)").catch(() => {});
            return;
        }

        // Captcha verification (CrowALL's `verify`).
        const captchaConfig = guardConfigRepo.getConfig(member.guild.id, identity.key, "captcha");
        if (captchaConfig?.enabled) {
            await captchaService.startCaptcha(member);
        }

        // Join message.
        const settings = guildSettingsRepo.getSettings(member.guild.id, identity.key);

        // Auto-role on join.
        if (settings?.auto_role_id && !member.user.bot) {
            await member.roles.add(settings.auto_role_id, "Rôle automatique à l'arrivée").catch(() => {});
        }

        if (settings?.join_channel_id && settings?.join_message) {
            const channel = await member.guild.channels.fetch(settings.join_channel_id).catch(() => null);
            if (channel?.isTextBased?.()) {
                const text = settings.join_message
                    .replaceAll("{user}", `${member}`)
                    .replaceAll("{server}", member.guild.name)
                    .replaceAll("{count}", String(member.guild.memberCount));
                await channel.send(text).catch(() => {});
            }
        }
    },
};
