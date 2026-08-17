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

// Demande une confirmation dans le salon même (auteur uniquement) avant de
// lancer le ban de masse — même pour toi/le propriétaire du serveur, `&banall`
// ne doit jamais partir directement.
async function requestChannelConfirmation(ctx, prompt) {
  if (!prompt) return false;
  try {
    const interaction = await prompt.awaitMessageComponent({
      filter: (i) => i.user.id === ctx.author.id,
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

// `&banall` n'est déclenchable sans validation que par le propriétaire du bot
// (super_sys) ou le propriétaire du serveur — un membre de confiance ajouté
// via `&banalladmins add` (voir utils/ownerTrustStore.js, seul autre cas
// autorisé par le niveau `owner`, utils/accessControl.js) doit d'abord
// obtenir l'accord d'un owner super_sys, demandé en MP. Avoir la permission
// Administrateur seule ne suffit plus (trop large : n'importe quel rôle admin
// aurait pu déclencher la demande).
async function requestOwnerApproval(ctx, reason) {
  const owners = botAdminsStore.list().filter((a) => a.tier === "super_sys");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("banall:confirm").setLabel("Autoriser").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("banall:cancel").setLabel("Refuser").setStyle(ButtonStyle.Secondary)
  );

  const dmMessages = [];
  for (const { userId } of owners) {
    const user = await ctx.client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    const dm = await user
      .send({
        content:
          `**${ctx.author.tag}** (${ctx.author.id}) veut lancer \`&banall\` sur **${ctx.guild.name}**.\n` +
          `Raison : ${reason}\n` +
          `Autorises-tu ce ban de masse ? (${Math.round(OWNER_APPROVAL_TIMEOUT_MS / 1000)}s avant expiration)`,
        components: [row],
      })
      .catch(() => null);
    if (dm) dmMessages.push(dm);
  }

  if (!dmMessages.length) return { approved: false, unreachable: true };

  const approved = await new Promise((resolve) => {
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

  return { approved, unreachable: false };
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

    const waiting = await ctx.reply(
      ctx.card({
        title: "Autorisation requise",
        description: "Demande envoyée en MP au propriétaire du bot — en attente de sa réponse.",
      })
    );

    const { approved, unreachable } = await requestOwnerApproval(ctx, reason);

    if (unreachable) {
      if (waiting) {
        await waiting
          .edit(ctx.card({ title: "Aucun propriétaire du bot joignable en MP, ban de masse annulé." }))
          .catch(() => {});
      }
      return;
    }

    if (!approved) {
      if (waiting) {
        await waiting.edit(ctx.card({ title: "Ban de masse refusé ou expiré." })).catch(() => {});
      }
      return;
    }

    const { success, failed } = await performBanAll(ctx, reason);
    if (waiting) {
      await waiting
        .edit(
          ctx.card({
            title: `${success} membre(s) banni(s).`,
            fields: failed ? [{ name: "Échecs", value: `${failed}` }] : [],
          })
        )
        .catch(() => {});
    }
  },
};
