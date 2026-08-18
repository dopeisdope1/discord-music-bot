"use strict";

const reminderRepo = require("../../db/repositories/reminderRepo");
const { UsageError } = require("../../core/errors");
const { parseDuration } = require("../../utils/time");

// No background sweeper exists yet for delivering due reminders (getDuePending
// is on the repo but nothing polls it). Lazily start one here, at module load,
// guarded so repeat requires/executions are cheap no-ops.
let sweeperStarted = false;
function startReminderSweeper(client) {
    if (sweeperStarted) return;
    sweeperStarted = true;
    setInterval(async () => {
        const due = reminderRepo.getDuePending(Date.now());
        for (const r of due) {
            reminderRepo.markDelivered(r.id);
            const channel = await client.channels.fetch(r.channel_id).catch(() => null);
            if (channel?.isTextBased?.()) {
                await channel.send(`⏰ <@${r.user_id}> Rappel : ${r.content}`).catch(() => {});
            }
        }
    }, 15_000);
}

module.exports = {
    name: "reminder",
    category: "public",
    description: "Configure un rappel.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        startReminderSweeper(ctx.client);

        if (ctx.args.length < 2) throw new UsageError("reminder <texte> <durée ex:10m>");

        const durationToken = ctx.args[ctx.args.length - 1];
        const ms = parseDuration(durationToken);
        if (!ms) throw new UsageError("reminder <texte> <durée ex:10m>");

        const content = ctx.args.slice(0, -1).join(" ");
        if (!content) throw new UsageError("reminder <texte> <durée ex:10m>");

        reminderRepo.create({
            userId: ctx.author.id,
            guildId: ctx.guildId,
            channelId: ctx.message.channel.id,
            remindAt: Date.now() + ms,
            content,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⏰ Rappel configuré",
                    description: `Je te rappellerai dans **${durationToken}** : ${content}`,
                }),
            ],
        });
    },
};
