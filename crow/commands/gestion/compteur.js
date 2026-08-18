"use strict";

const { ChannelType, PermissionsBitField } = require("discord.js");
const { getDb } = require("../../db/connection");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

const KIND_TEMPLATES = {
    members: "👥 Membres: {count}",
    voice: "🔊 En vocal: {count}",
};

function countFor(guild, kind) {
    if (kind === "voice") {
        let n = 0;
        for (const channel of guild.channels.cache.values()) {
            if (channel.isVoiceBased?.()) n += channel.members.size;
        }
        return n;
    }
    return guild.memberCount;
}

// NOTE: this only creates the counter channel and sets its initial name/count.
// Live updates on member join/leave would need guildMemberAdd/guildMemberRemove
// event hooks (outside src/commands/gestion/) to call channel.setName() again —
// not wired here, see final report.
module.exports = {
    name: "compteur",
    category: "gestion",
    description: "Gère les compteurs de membres vocaux/membres.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const kind = (ctx.args[0] || "").toLowerCase();
        if (kind !== "members" && kind !== "voice") {
            throw new UsageError("compteur <members|voice>");
        }

        const template = KIND_TEMPLATES[kind];
        const count = countFor(ctx.guild, kind);

        let channel;
        try {
            channel = await ctx.guild.channels.create({
                name: template.replace("{count}", count),
                type: ChannelType.GuildVoice,
                permissionOverwrites: [
                    {
                        id: ctx.guild.roles.everyone,
                        deny: [PermissionsBitField.Flags.Connect],
                    },
                ],
            });
        } catch (error) {
            throw new BotError(`Impossible de créer le salon compteur : ${error.message}`);
        }

        const db = getDb();
        db.prepare(
            "INSERT OR REPLACE INTO member_counters (channel_id, guild_id, kind, template) VALUES (?, ?, ?, ?)"
        ).run(channel.id, ctx.guildId, kind, template);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔢 Compteur créé",
                    description: `${channel} affiche désormais ${
                        kind === "members" ? "le nombre de membres" : "le nombre de membres en vocal"
                    } (${count}).\n⚠️ La mise à jour en temps réel n'est pas branchée : le nom ne se rafraîchira pas automatiquement lors des arrivées/départs tant qu'un hook \`guildMemberAdd\`/\`guildMemberRemove\` ne le fait pas.`,
                }),
            ],
        });
    },
};
