"use strict";

const { ChannelType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "backup",
    category: "owner",
    description: "Gère les sauvegardes de serveurs.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();
        const usage = "backup <create | list | restore <id>>";

        if (sub === "create") {
            const channels = ctx.guild.channels.cache.map((c) => ({
                name: c.name,
                type: c.type,
                parentName: c.parent?.name || null,
                position: c.position,
            }));
            const roles = ctx.guild.roles.cache
                .filter((r) => r.id !== ctx.guild.id) // skip @everyone, it always exists
                .map((r) => ({
                    name: r.name,
                    color: r.color,
                    permissions: r.permissions.bitfield.toString(),
                    position: r.position,
                }));

            const data = JSON.stringify({ guildName: ctx.guild.name, channels, roles });
            const result = ctx.db
                .prepare("INSERT INTO backups (guild_id, data, created_at) VALUES (?, ?, ?)")
                .run(ctx.guildId, data, Date.now());

            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "💾 Sauvegarde créée",
                        description: `Sauvegarde #${result.lastInsertRowid} créée : ${channels.length} salon(s), ${roles.length} rôle(s).`,
                    }),
                ],
            });
        } else if (sub === "list") {
            const rows = ctx.db
                .prepare("SELECT id, created_at FROM backups WHERE guild_id = ? ORDER BY created_at DESC LIMIT 15")
                .all(ctx.guildId);

            if (!rows.length) {
                await ctx.reply({ embeds: [ctx.embed({ title: "💾 Sauvegardes", description: "Aucune sauvegarde enregistrée." })] });
                return;
            }

            const lines = rows.map((r) => `#${r.id} — <t:${Math.floor(r.created_at / 1000)}:f>`);

            await ctx.reply({ embeds: [ctx.embed({ title: "💾 Sauvegardes récentes", description: lines.join("\n") })] });
        } else if (sub === "restore") {
            const id = Number(ctx.args[1]);
            if (!Number.isInteger(id)) throw new UsageError(usage);

            const row = ctx.db.prepare("SELECT * FROM backups WHERE guild_id = ? AND id = ?").get(ctx.guildId, id);
            if (!row) throw new BotError(`Sauvegarde #${id} introuvable.`);

            const data = JSON.parse(row.data);

            let rolesCreated = 0;
            for (const r of data.roles || []) {
                const exists = ctx.guild.roles.cache.some((role) => role.name === r.name);
                if (exists) continue;
                await ctx.guild.roles
                    .create({ name: r.name, color: r.color, permissions: BigInt(r.permissions), reason: `Restauration backup #${id}` })
                    .then(() => rolesCreated++)
                    .catch(() => {});
            }

            const backupChannels = data.channels || [];
            const categories = backupChannels.filter((c) => c.type === ChannelType.GuildCategory);
            const others = backupChannels.filter((c) => c.type !== ChannelType.GuildCategory);

            let channelsCreated = 0;
            for (const c of categories) {
                const exists = ctx.guild.channels.cache.some((ch) => ch.type === ChannelType.GuildCategory && ch.name === c.name);
                if (exists) continue;
                await ctx.guild.channels
                    .create({ name: c.name, type: ChannelType.GuildCategory, reason: `Restauration backup #${id}` })
                    .then(() => channelsCreated++)
                    .catch(() => {});
            }

            for (const c of others) {
                const exists = ctx.guild.channels.cache.some((ch) => ch.name === c.name && ch.type === c.type);
                if (exists) continue;
                const parent = c.parentName
                    ? ctx.guild.channels.cache.find((ch) => ch.type === ChannelType.GuildCategory && ch.name === c.parentName)
                    : null;
                await ctx.guild.channels
                    .create({ name: c.name, type: c.type, parent: parent?.id, reason: `Restauration backup #${id}` })
                    .then(() => channelsCreated++)
                    .catch(() => {});
            }

            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "♻️ Restauration best-effort terminée",
                        description: [
                            `${rolesCreated} rôle(s) et ${channelsCreated} salon(s) manquant(s) recréé(s) par nom, à partir de la sauvegarde #${id}.`,
                            "⚠️ Cette restauration est **best-effort** : les rôles/salons déjà existants n'ont pas été touchés (aucune suppression/écrasement), et les permissions spécifiques par salon (permission overwrites) ne sont **pas** recréées à l'identique.",
                        ].join("\n\n"),
                    }),
                ],
            });
        } else {
            throw new UsageError(usage);
        }
    },
};
