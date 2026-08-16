const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { resolveTargetMember, assertCanModerate } = require("../../utils/moderationTargetHelpers");
const muteStore = require("../../utils/muteStore");
const sanctionsStore = require("../../utils/sanctionsStore");
const { sendLog } = require("../../utils/actionLogger");

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h, utilisé quand le mode configuré est "timeout".

module.exports = {
  name: "mute",
  category: "moderation",
  description: "Mute un membre du serveur",
  usage: "&mute <@mention | id> [raison]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    if (!ctx.args[0]) throw new UsageError(this.usage);
    const target = await resolveTargetMember(ctx, ctx.args[0], this.usage);
    assertCanModerate(ctx, target);

    const cfg = muteStore.getConfig(ctx.guildId);
    const reason = ctx.args.slice(1).join(" ") || "Aucune raison fournie";

    if (!cfg.allowCustomReasons) {
      const presets = muteStore.listReasons(ctx.guildId);
      if (ctx.args.slice(1).length && !presets.includes(reason)) {
        throw new BotError("Les raisons personnalisées sont interdites. Utilise une raison configurée dans &panel.");
      }
    }

    let expiresAt = null;
    if (cfg.mode === "role") {
      if (!cfg.muteRoleId) throw new BotError("Aucun rôle de mute configuré. Utilise &panel.");
      await target.roles.add(cfg.muteRoleId, reason);
    } else {
      expiresAt = Date.now() + DEFAULT_TIMEOUT_MS;
      await target.timeout(DEFAULT_TIMEOUT_MS, reason);
    }

    muteStore.setActive(ctx.guildId, target.id, { reason, mutedBy: ctx.author.id, expiresAt });
    sanctionsStore.add(ctx.guildId, target.id, "mute", reason, ctx.author.id);
    sendLog(ctx.client, ctx.guildId, "moderation", {
      title: "Mute",
      description: `${target.user.tag} a été muté.`,
      actor: ctx.author,
      fields: [{ name: "Raison", value: reason }],
    });

    await ctx.reply(ctx.card({ title: `${target.user.tag} a été muté.`, fields: [{ name: "Raison", value: reason }] }));
  },
};
