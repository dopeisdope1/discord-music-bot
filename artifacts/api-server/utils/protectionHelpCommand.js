const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");

// "!!help" — index des commandes sur le préfixe "!!" (utils/
// personalProtection.js, utils/securityPanel.js, utils/securityAliases.js,
// utils/serverAdminCommands.js::handleSecurityOwnerTextCommand, utils/
// confessions.js, utils/setClearCommand.js), qui n'apparaissent
// volontairement PAS dans "&help" (utils/helpPanel.js, préfixe "&" —
// architecture 4 préfixes : & = gestion, - = modération, !! = sécurité,
// = = vocal/owner).
// Purement informatif, aucune interaction : une simple carte texte à jour
// à la main si une commande "!!" s'ajoute. Groupé en 2 : "Sécurité serveur"
// (le vrai écosystème sécurité demandé) et "Protection personnelle"
// (!!panel — self-service par membre, distincte de la sécurité serveur,
// mais reste sur ce même préfixe : rien à casser en la déplaçant).
const COMMANDES = [
  {
    groupe: "Sécurité serveur",
    nom: "!!secur",
    description: "Panneau de sécurité serveur + anti-nuke — droit `protection.automod` et/ou `protection.guard.manage`.",
  },
  { groupe: "Sécurité serveur", nom: "!!security", description: "Alias de `!!secur` — ouvre exactement le même panneau." },
  { groupe: "Sécurité serveur", nom: "!!owner <@membre>", description: "Accorde/retire des permissions de sécurité individuelles (catégorie Protection) — droit `panel.permissions.manage`." },
  { groupe: "Sécurité serveur", nom: "!!wl [@membre]", description: "Whitelist ANTI-NUKE (distincte de `!!whitelist`) — droit `protection.guard.manage`." },
  { groupe: "Sécurité serveur", nom: "!!unwl <@membre>", description: "Retire de la whitelist anti-nuke — droit `protection.guard.manage`." },
  { groupe: "Sécurité serveur", nom: "!!whitelist", description: "Whitelist ANTI-SPAM (distincte de `!!wl`) — droit `protection.whitelist`." },
  { groupe: "Sécurité serveur", nom: "!!unwhitelist <@membre>", description: "Retire de la whitelist anti-spam — droit `protection.whitelist`." },
  { groupe: "Sécurité serveur", nom: "!!antinuke", description: "Configure l'anti-nuke (identique à `!!antiraid`) — droit `protection.guard.manage`." },
  { groupe: "Sécurité serveur", nom: "!!antiraid", description: "Synonyme de `!!antinuke` — même moteur, aucun système parallèle." },
  { groupe: "Sécurité serveur", nom: "!!antilink [on/off]", description: "Anti-lien — droit `protection.automod`." },
  { groupe: "Sécurité serveur", nom: "!!antispam [on/off]", description: "Anti-spam/anti-flood — droit `protection.automod`." },
  {
    groupe: "Protection personnelle",
    nom: "!!panel",
    description: "Tes protections personnelles (anti-ban/kick/timeout forcés...) — aucune permission requise.",
  },
  {
    groupe: "Autres",
    nom: "!!confess",
    description:
      "Confessions anonymes. `setup` réservé à `server.confessions.setup`, `validation` à `server.confessions.validation`, Accepter/Refuser à `server.confessions.manage`.",
  },
  { groupe: "Autres", nom: "!!setclear", description: "Configure le nettoyage automatique (`<nom> clear`) — droit `server.selfclear.manage`." },
];

function buildProtectionHelpCard(prefix = "!!") {
  const container = new ContainerBuilder();
  const afficher = (texte) => texte.replaceAll("!!", prefix);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🛡️ Commandes "${prefix}"`));

  const groupes = [...new Set(COMMANDES.map((c) => c.groupe))];
  for (const groupe of groupes) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**${groupe}**`,
          ...COMMANDES.filter((c) => c.groupe === groupe).map((c) => `**${afficher(c.nom)}** — ${afficher(c.description)}`),
        ].join("\n")
      )
    );
  }
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function handleProtectionHelpTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "help") return; // mot inconnu sur ce préfixe : silence

  return message.channel.send(buildProtectionHelpCard(PREFIX)).catch(() => {});
}

module.exports = { handleProtectionHelpTextCommand, buildProtectionHelpCard };
