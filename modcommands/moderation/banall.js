const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { sendLog } = require("../../utils/actionLogger");
const sanctionsStore = require("../../utils/sanctionsStore");
const botAdminsStore = require("../../utils/botAdminsStore");
const { fetchAllMembers, memberFetchErrorMessage } = require("../../utils/guildMembers");
const { BotError } = require("../../utils/modErrors");
const { buildCard, payload } = require("../../utils/panelComponents");

const OWNER_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 30 * 1000;

function buildConfirmCard(title, description) {
  const container = buildCard({ title, description });
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("banall:confirm").setLabel("Confirmer").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("banall:cancel").setLabel("Annuler").setStyle(ButtonStyle.Secondary)
    )
  );
  return payload(container);
}

// Propriétaire du bot (super_sys) ou propriétaire réel du serveur — les deux
// seuls autorisés à valider un `&banall`, que ce soit leur propre confirmation
// (requestChannelConfirmation) ou la demande d'un tiers (requestOwnerApproval).
function canApprove(ctx, userId) {
  return botAdminsStore.isSuperSys(userId) || userId === ctx.guild.ownerId;
}

// Demande une confirmation dans le salon même avant de lancer le ban de
// masse — même pour toi/le propriétaire du serveur, `&banall` ne doit jamais
// partir directement. Seuls le propriétaire du bot et le propriétaire réel du
// serveur peuvent cliquer (pas forcément l'auteur de la commande).
async function requestChannelConfirmation(ctx, prompt) {
  if (!prompt) return false;
  try {
    const interaction = await prompt.awaitMessageComponent({
      filter: (i) => canApprove(ctx, i.user.id),
      time: CONFIRM_TIMEOUT_MS,
    });
    const confirmed = interaction.customId === "banall:confirm";
    await interaction
      .update(ctx.card({ title: confirmed ? "Confirmé, bannissement en cours..." : "Ban de masse annulé." }))
      .catch(() => {});
    return confirmed;
  } catch {
    await prompt.edit(ctx.card({ title: "Délai dépassé, ban de masse annulé." })).catch(() => {});
    return false;
  }
}

async function performBanAll(ctx, reason) {
  const members = await fetchAllMembers(ctx.guild).catch((err) => {
    throw new BotError(memberFetchErrorMessage(err) || "Impossible de récupérer la liste des membres.");
  });

  const targets = members.filter((m) => !m.user.bot && m.id !== ctx.guild.ownerId && m.id !== ctx.author.id);

  let success = 0;
  let failed = 0;
  for (const member of targets.values()) {
    try {
      await ctx.guild.members.ban(member.id, { reason });
      sanctionsStore.add(ctx.guildId, member.id, "ban", reason, ctx.author.id);
      success += 1;
    } catch (err) {
      console.error("[banall] échec du ban :", err);
      failed += 1;
    }
  }

  sendLog(ctx.client, ctx.guildId, "moderation", {
    title: "Ban de masse",
    description: `${success} membre(s) banni(s)${failed ? ` (${failed} échec(s))` : ""} via \`&banall\`.`,
    actor: ctx.author,
  });

  return { success, failed };
}

// `&banall` n'est déclenchable directement que par le propriétaire du bot
// (super_sys) ou le propriétaire réel du serveur. N'importe quel autre
// Administrateur qui tente la commande se fait simplement répondre qu'il n'y
// a pas accès — en coulisses, le bot ping en MP le propriétaire réel ET tous
// les propriétaires du bot pour leur demander de lui donner la permission.
// Seul le propriétaire réel ou un propriétaire du bot peut Autoriser/Refuser
// (voir canApprove) ; le demandeur, lui, ne voit jamais le résultat.
async function requestOwnerApproval(ctx, reason) {
  const superSysIds = botAdminsStore
    .list()
    .filter((a) => a.tier === "super_sys")
    .map((a) => a.userId);
  const recipientIds = [...new Set([...superSysIds, ctx.guild.ownerId])];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("banall:confirm").setLabel("Autoriser").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("banall:cancel").setLabel("Refuser").setStyle(ButtonStyle.Secondary)
  );

  const dmMessages = [];
  for (const userId of recipientIds) {
    const user = await ctx.client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    const dm = await user
      .send({
        content:
          `**${ctx.author.tag}** (${ctx.author.id}) n'a pas accès à \`&banall\` sur **${ctx.guild.name}** et voudrait l'utiliser.\n` +
          `Raison : ${reason}\n` +
          `Donne-lui la permission d'exécuter ce ban de masse ? (${Math.round(
            OWNER_APPROVAL_TIMEOUT_MS / 1000
          )}s avant expiration)`,
        components: [row],
      })
      .catch(() => null);
    if (dm) dmMessages.push(dm);
  }

  if (!dmMessages.length) return false;

  return new Promise((resolve) => {
    let settled = false;
    const collectors = dmMessages.map((dm) =>
      dm.createMessageComponentCollector({ time: OWNER_APPROVAL_TIMEOUT_MS, max: 1 })
    );

    const settle = async (result, interaction) => {
      if (settled) return;
      settled = true;
      for (const c of collectors) c.stop();

      const label = result ? "Autorisé." : "Refusé ou expiré.";
      if (interaction) await interaction.update({ content: label, components: [] }).catch(() => {});
      for (const dm of dmMessages) {
        if (interaction && dm.id === interaction.message.id) continue;
        await dm.edit({ components: [] }).catch(() => {});
      }
      resolve(result);
    };

    for (const collector of collectors) {
      collector.on("collect", (i) => settle(i.customId === "banall:confirm", i));
      collector.on("end", (collected) => {
        if (collected.size === 0) settle(false, null);
      });
    }
  });
}

module.exports = {
  name: "banall",
  category: "moderation",
  description: "Bannit tous les membres du serveur (hors bots, toi-même et le propriétaire)",
  usage: "&banall [raison]",
  level: LEVEL.OWNER,
  async execute(ctx) {
    if (!ctx.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      await ctx.reply(ctx.card({ title: "Il me manque la permission Bannir des membres." }));
      return;
    }

    const reason = ctx.args.join(" ") || "Ban de masse";
    const isTopLevel = ctx.isSuperSys || ctx.author.id === ctx.guild.ownerId;

    if (isTopLevel) {
      const prompt = await ctx.reply(
        buildConfirmCard(
          "Confirmer le ban de masse ?",
          `Tous les membres de **${ctx.guild.name}** seront bannis (hors bots, toi-même et le propriétaire).\nRaison : ${reason}\n${Math.round(
            CONFIRM_TIMEOUT_MS / 1000
          )}s pour confirmer.`
        )
      );

      const confirmed = await requestChannelConfirmation(ctx, prompt);
      if (!confirmed) return;

      const { success, failed } = await performBanAll(ctx, reason);
      if (prompt) {
        await prompt
          .edit(
            ctx.card({
              title: `${success} membre(s) banni(s).`,
              fields: failed ? [{ name: "Échecs", value: `${failed}` }] : [],
            })
          )
          .catch(() => {});
      }
      return;
    }

    await ctx.reply(ctx.card({ title: "Tu n'as pas accès à cette commande." }));

    const approved = await requestOwnerApproval(ctx, reason);
    if (!approved) return;

    await performBanAll(ctx, reason);
  },
};
