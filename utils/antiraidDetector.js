const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const antiraidConfigStore = require("./antiraidConfigStore");
const { getLogChannelId } = require("./logStore");
const botAdminsStore = require("./botAdminsStore");

const EWMA_ALPHA = 0.3;
const WARMUP_SAMPLES = 4;
const TIER_ORDER = ["lock", "throttle", "warn"];
const LOCKDOWN_DURATION_MS = 10 * 60 * 1000;

// Stats EWMA par (guildId, userId) — en mémoire uniquement, un redémarrage
// fait juste repartir le "réchauffement" à zéro (pas grave, contrairement à
// la config, voir utils/antiraidConfigStore.js).
const stats = new Map();
const lockdowns = new Map(); // guildId -> true (verrouillé actuellement)

function statsKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

// Score l'échantillon actuel par rapport à la moyenne/variance AVANT
// intégration de cet échantillon (pour qu'une action ne dilue pas son propre
// score d'anomalie), puis met à jour les stats glissantes. Retourne null
// pendant le "réchauffement" (jamais de palier déclenché).
function recordSample(guildId, userId) {
  const now = Date.now();
  const key = statsKey(guildId, userId);
  const prev = stats.get(key);

  if (!prev) {
    stats.set(key, { mean: 0, variance: 0, lastTs: now, count: 1 });
    return null;
  }

  const interval = (now - prev.lastTs) / 1000;
  const count = prev.count + 1;

  let z = null;
  if (count >= WARMUP_SAMPLES) {
    const stddev = Math.sqrt(prev.variance) || 1;
    z = (prev.mean - interval) / stddev;
  }

  const diff = interval - prev.mean;
  const newMean = prev.count === 0 ? interval : prev.mean + EWMA_ALPHA * diff;
  const newVariance = prev.count === 0 ? 0 : (1 - EWMA_ALPHA) * (prev.variance + EWMA_ALPHA * diff * diff);

  stats.set(key, { mean: newMean, variance: newVariance, lastTs: now, count });
  return z;
}

// "Si un palier déclenché est désactivé, il retombe sur le palier inférieur
// actif (sinon rien)" : trouve le palier le plus haut franchi par le
// z-score, puis redescend jusqu'au premier palier activé.
function resolveTier(guildId, z) {
  if (z == null) return null;
  const cfg = antiraidConfigStore.getConfig(guildId);

  let raw = null;
  if (z >= cfg.lockThreshold) raw = "lock";
  else if (z >= cfg.throttleThreshold) raw = "throttle";
  else if (z >= cfg.warnThreshold) raw = "warn";
  if (!raw) return null;

  for (let i = TIER_ORDER.indexOf(raw); i < TIER_ORDER.length; i++) {
    const tier = TIER_ORDER[i];
    if (cfg[`${tier}Enabled`]) return tier;
  }
  return null;
}

async function logIncident(guild, member, command, tier, z) {
  const description = `**${tier.toUpperCase()}** déclenché pour <@${member.id}> sur \`${command.name}\` (z-score ${z.toFixed(2)}).`;
  const channelId = getLogChannelId(guild.id, "raid");
  const channel = channelId ? guild.channels.cache.get(channelId) : null;

  if (channel?.isTextBased()) {
    await channel.send({ content: description }).catch(() => {});
    return;
  }

  for (const admin of botAdminsStore.list()) {
    const user = await guild.client.users.fetch(admin.userId).catch(() => null);
    if (user) await user.send(`⚠️ [${guild.name}] ${description}`).catch(() => {});
  }
}

async function requestConfirmation(message, command) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("antiraid:confirm").setLabel("Confirmer").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("antiraid:cancel").setLabel("Annuler").setStyle(ButtonStyle.Secondary)
  );

  const prompt = await message.reply({
    content: `⏸️ Activité inhabituelle détectée sur \`${command.name}\`. Confirme pour continuer (30s).`,
    components: [row],
  });

  try {
    const interaction = await prompt.awaitMessageComponent({
      filter: (i) => i.user.id === message.author.id,
      time: 30_000,
    });
    await interaction.update({ content: "✅ Confirmé.", components: [] });
    return interaction.customId === "antiraid:confirm";
  } catch {
    await prompt.edit({ content: "⌛ Délai dépassé, action annulée.", components: [] }).catch(() => {});
    return false;
  }
}

async function triggerLockdown(guild, triggeredByUserId) {
  const everyone = guild.roles.everyone;
  if (!everyone.permissions.has(PermissionFlagsBits.SendMessages)) return; // déjà verrouillé

  await everyone.setPermissions(
    everyone.permissions.remove(PermissionFlagsBits.SendMessages),
    "Anti-raid : verrouillage automatique"
  );
  lockdowns.set(guild.id, true);

  setTimeout(() => liftLockdown(guild).catch(() => {}), LOCKDOWN_DURATION_MS);
}

async function liftLockdown(guild) {
  if (!lockdowns.get(guild.id)) return;
  const everyone = guild.roles.everyone;
  await everyone.setPermissions(
    everyone.permissions.add(PermissionFlagsBits.SendMessages),
    "Anti-raid : fin du verrouillage"
  );
  lockdowns.delete(guild.id);
}

// Exécuté avant qu'une commande "configurable" ne s'exécute. Retourne { proceed }.
async function applyTier(message, command, tier, ctx, z) {
  const guild = message.guild;

  if (tier === "warn") {
    await logIncident(guild, message.member, command, tier, z);
    return { proceed: true };
  }

  if (tier === "throttle") {
    await logIncident(guild, message.member, command, tier, z);
    const confirmed = await requestConfirmation(message, command);
    return { proceed: confirmed };
  }

  if (tier === "lock") {
    await logIncident(guild, message.member, command, tier, z);
    await triggerLockdown(guild, message.author.id);
    await ctx.reply(
      ctx.card({
        title: "🔒 Activité anormale détectée",
        description:
          "Le serveur a été verrouillé par mesure de précaution (@everyone ne peut plus envoyer de messages). Cette commande n'a pas été exécutée.",
      })
    );
    return { proceed: false };
  }

  return { proceed: true };
}

module.exports = { recordSample, resolveTier, applyTier, triggerLockdown, liftLockdown };
