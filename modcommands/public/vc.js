const { ActivityType } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");

module.exports = {
  name: "vc",
  category: "public",
  description: "Affiche les statistiques du serveur (membres, en ligne, en vocal...)",
  usage: "&vc",
  level: LEVEL.PUBLIC,
  async execute(ctx) {
    const guild = ctx.guild;

    const voiceStates = [...guild.voiceStates.cache.values()].filter((v) => v.channelId);
    const enVocal = voiceStates.length;
    const enMute = voiceStates.filter((v) => v.mute || v.selfMute).length;

    const members = [...guild.members.cache.values()];
    const enLigne = members.filter((m) => m.presence && m.presence.status !== "offline").length;
    const actif = members.filter((m) => m.presence?.activities.some((a) => a.type !== ActivityType.Custom)).length;
    const enStream = members.filter((m) => m.presence?.activities.some((a) => a.type === ActivityType.Streaming)).length;

    await ctx.reply(
      ctx.card({
        title: `Statistiques de ${guild.name}`,
        description: `Il y a actuellement **${enVocal}** membre(s) en vocal.`,
        thumbnail: guild.iconURL({ size: 256 }) || undefined,
        fields: [
          { name: "Membres", value: String(guild.memberCount) },
          { name: "En Ligne", value: String(enLigne) },
          { name: "En Vocal", value: String(enVocal) },
          { name: "Actif", value: String(actif) },
          { name: "En Stream", value: String(enStream) },
          { name: "Mute", value: String(enMute) },
        ],
      })
    );
  },
};
