"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const guardConfigRepo = require("../db/repositories/guardConfigRepo");
const { getDb } = require("../db/connection");
const { registerButtonHandler } = require("../core/interactionRegistry");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function buildVerifyButton(guildId, userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`captcha:${guildId}:${userId}`)
            .setLabel("✅ Je suis humain, vérifier")
            .setStyle(ButtonStyle.Success)
    );
}

async function startCaptcha(member, { channel } = {}) {
    const expiresAt = Date.now() + DEFAULT_TIMEOUT_MS;
    guardConfigRepo.setCaptchaPending(member.guild.id, member.id, "button", expiresAt);

    const target = channel || member;
    await target
        .send({
            content: `${member}, bienvenue sur **${member.guild.name}** ! Clique sur le bouton ci-dessous pour vérifier que tu es humain (expire dans 10 minutes).`,
            components: [buildVerifyButton(member.guild.id, member.id)],
        })
        .catch(() => {});
}

async function handleVerifyInteraction(interaction) {
    const [, guildId, userId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
        return interaction.reply({ content: "Ce bouton ne t'est pas destiné.", ephemeral: true });
    }

    const pending = guardConfigRepo.getCaptchaPending(guildId, userId);
    if (!pending) {
        return interaction.reply({ content: "Vérification déjà effectuée ou expirée.", ephemeral: true });
    }

    guardConfigRepo.clearCaptchaPending(guildId, userId);

    const config = guardConfigRepo.getConfig(guildId, interaction.client.identity.key, "captcha");
    const verifiedRoleId = config?.settings_json ? JSON.parse(config.settings_json).verifiedRoleId : null;

    if (verifiedRoleId) {
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        await member?.roles.add(verifiedRoleId, "Vérification captcha réussie").catch(() => {});
    }

    return interaction.reply({ content: "✅ Vérification réussie, bienvenue !", ephemeral: true });
}

// Kicks members who never completed verification within the timeout. Call
// periodically (see events/ready.event.js sweeper wiring).
async function sweepExpired(client) {
    const db = getDb();
    const now = Date.now();
    const expired = db.prepare("SELECT * FROM captcha_pending WHERE expires_at <= ?").all(now);

    for (const row of expired) {
        guardConfigRepo.clearCaptchaPending(row.guild_id, row.user_id);
        const guild = client.guilds.cache.get(row.guild_id);
        const member = guild ? await guild.members.fetch(row.user_id).catch(() => null) : null;
        await member?.kick("Vérification captcha non complétée à temps").catch(() => {});
    }
}

registerButtonHandler("captcha", (interaction) => handleVerifyInteraction(interaction));

module.exports = { startCaptcha, handleVerifyInteraction, sweepExpired, buildVerifyButton };
