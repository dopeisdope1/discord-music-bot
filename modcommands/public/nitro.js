const { LEVEL } = require("../../utils/permLevels");
const { extractUserId } = require("../../utils/argParsing");
const { BADGE_TIERS, computeTierState, progressBar } = require("../../utils/badgeProgress");
const nitroStore = require("../../utils/nitroStore");

// Version courte de la vue "Nitro" de &zinki, mêmes règles : vraie date
// d'abonnement si elle a été saisie (&setnitro ou le bouton de &zinki),
// sinon repli sur l'ancienneté du compte, étiqueté comme estimation.
// L'API bot n'expose aucune donnée Nitro (ni statut, ni date).
module.exports = {
  name: "nitro",
  category: "public",
  description: "Affiche une progression de paliers façon Nitro, basée sur l'ancienneté du compte",
  usage: "&nitro [username | @mention]",
  level: LEVEL.PUBLIC,
  async execute(ctx) {
    const raw = ctx.args[0];
    const userId = raw ? extractUserId(raw) : ctx.author.id;
    const member = userId
      ? await ctx.guild.members.fetch(userId).catch(() => null)
      : ctx.guild.members.cache.find((m) => m.user.username === raw);

    if (!member) {
      await ctx.reply(ctx.card({ title: "❌ Utilisateur introuvable" }));
      return;
    }

    const realStart = nitroStore.getNitroSince(member.id);
    const start = realStart || member.user.createdAt;
    const state = computeTierState(start, BADGE_TIERS);
    const unix = (d) => Math.floor(new Date(d).getTime() / 1000);

    const fields = [
      realStart
        ? { name: "Abonné depuis", value: `<t:${unix(start)}:F>` }
        : { name: "Compte créé", value: `<t:${unix(start)}:F> — *estimation, date Nitro non renseignée*` },
      { name: "Badge actuel", value: `${state.currentTier.emoji} **${state.currentTier.label}** — <t:${unix(state.currentTierDate)}:R>` },
    ];

    if (state.maxed) {
      fields.push({ name: "Progression", value: "Palier maximum atteint 🎉" });
    } else {
      fields.push({ name: "Prochain badge", value: `${state.nextTier.emoji} **${state.nextTier.label}** — <t:${unix(state.nextTierDate)}:R>` });
      fields.push({ name: "Progression", value: `${progressBar(state.percent)} \`${state.percent}%\`` });
    }

    fields.push({
      name: "Tous les paliers",
      value: state.tierDates.map(({ tier, date }) => `${tier.emoji} **${tier.label}** : <t:${unix(date)}:d>`).join("\n"),
    });

    await ctx.reply(
      ctx.card({
        title: `Progression Nitro de ${member.displayName}`,
        thumbnail: member.displayAvatarURL({ size: 256 }),
        fields,
      })
    );
  },
};
