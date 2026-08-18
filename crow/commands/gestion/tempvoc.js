"use strict";

const { ChannelType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");
const voiceRepo = require("../../db/repositories/voiceRepo");

// KNOWN LIMITATION: this writes to the same voice_config table CrowMASTER's
// tempVoiceService reads, but events/voiceStateUpdate.event.js currently has
// `if (identity.key !== "crowmaster") return;` — so config saved here only
// actually takes effect at runtime for the crowmaster identity until that
// guard is relaxed elsewhere (outside src/commands/gestion/). See final report.
module.exports = {
    name: "tempvoc",
    category: "gestion",
    description: "Configure les salons vocaux temporaires.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();

        if (sub === "hub") {
            const id = extractChannelId(ctx.args[1]);
            if (!id) throw new UsageError("tempvoc hub #salon-vocal");

            const channel = ctx.guild.channels.cache.get(id);
            if (!channel || channel.type !== ChannelType.GuildVoice) {
                throw new BotError("Ce salon doit être un salon vocal existant sur ce serveur.");
            }

            voiceRepo.setConfigField(ctx.guildId, "hub_channel_id", id);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🔊 Hub vocal configuré",
                        description: `${channel} est désormais le salon hub pour les vocaux temporaires.\n⚠️ Actif uniquement pour l'identité CrowMASTER tant que le hook \`voiceStateUpdate\` n'écoute pas aussi CrowALL.`,
                    }),
                ],
            });
            return;
        }

        if (sub === "category") {
            const id = extractChannelId(ctx.args[1]);
            if (!id) throw new UsageError("tempvoc category #categorie");

            const channel = ctx.guild.channels.cache.get(id);
            if (!channel || channel.type !== ChannelType.GuildCategory) {
                throw new BotError("Ce salon doit être une catégorie existante sur ce serveur.");
            }

            voiceRepo.setConfigField(ctx.guildId, "category_id", id);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🔊 Catégorie vocale configurée",
                        description: `Les vocaux temporaires seront créés sous **${channel.name}**.\n⚠️ Actif uniquement pour l'identité CrowMASTER tant que le hook \`voiceStateUpdate\` n'écoute pas aussi CrowALL.`,
                    }),
                ],
            });
            return;
        }

        throw new UsageError("tempvoc <hub|category> #salon");
    },
};
