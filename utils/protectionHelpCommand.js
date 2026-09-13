const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");

// "!!help" — index des commandes sur le préfixe "!!" (utils/
// personalProtection.js, utils/securityPanel.js, utils/confessions.js,
// utils/setClearCommand.js), qui n'apparaissent volontairement PAS dans
// "&help" (utils/helpPanel.js, préfixe "&", commandes de gestion — demande
// explicite : "&help pour la gestion, !!help pour la sécurité"). Purement
// informatif, aucune interaction : une simple carte texte à jour à la main
// si une commande "!!" s'ajoute.
const COMMANDES = [
  { nom: "!!panel", description: "Tes protections personnelles (anti-ban/kick/timeout forcés...) — aucune permission requise." },
  {
    nom: "!!secur",
    description: "Sécurité serveur + anti-nuke — droit `protection.automod` et/ou `protection.guard.manage`.",
  },
  {
    nom: "!!confess",
    description:
      "Confessions anonymes. `setup` réservé à `server.confessions.setup`, `validation` à `server.confessions.validation`, Accepter/Refuser à `server.confessions.manage`.",
  },
  { nom: "!!setclear", description: "Configure le nettoyage automatique (`<nom> clear`) — droit `server.selfclear.manage`." },
];

function buildProtectionHelpCard() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🛡️ Commandes \"!!\""));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(COMMANDES.map((c) => `**${c.nom}** — ${c.description}`).join("\n\n"))
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function handleProtectionHelpTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "help") return; // mot inconnu sur ce préfixe : silence, comme "&"

  return message.channel.send(buildProtectionHelpCard()).catch(() => {});
}

module.exports = { handleProtectionHelpTextCommand, buildProtectionHelpCard };
