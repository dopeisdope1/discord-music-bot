const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { can, hasConfiguredAccess } = require("./permissions/engine");

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
    groupe: "Aide",
    nom: "!!help",
    permission: null,
    description: "Affiche cette aide.",
  },
  {
    groupe: "Sécurité serveur",
    nom: "!!secur",
    permission: ["protection.automod", "protection.guard.manage"],
    description: "Panneau de sécurité serveur + anti-nuke — droit `protection.automod` et/ou `protection.guard.manage`.",
  },
  { groupe: "Sécurité serveur", nom: "!!security", permission: ["protection.automod", "protection.guard.manage"], description: "Alias de `!!secur` — ouvre exactement le même panneau." },
  { groupe: "Sécurité serveur", nom: "!!owner <@membre>", permission: "panel.permissions.manage", description: "Accorde/retire des permissions de sécurité individuelles (catégorie Protection) — droit `panel.permissions.manage`." },
  { groupe: "Sécurité serveur", nom: "!!wl [@membre]", permission: "protection.guard.manage", description: "Whitelist ANTI-NUKE (distincte de `!!whitelist`) — droit `protection.guard.manage`." },
  { groupe: "Sécurité serveur", nom: "!!unwl <@membre>", permission: "protection.guard.manage", description: "Retire de la whitelist anti-nuke — droit `protection.guard.manage`." },
  { groupe: "Sécurité serveur", nom: "!!whitelist", permission: "protection.whitelist", description: "Whitelist ANTI-SPAM (distincte de `!!wl`) — droit `protection.whitelist`." },
  { groupe: "Sécurité serveur", nom: "!!unwhitelist <@membre>", permission: "protection.whitelist", description: "Retire de la whitelist anti-spam — droit `protection.whitelist`." },
  { groupe: "Sécurité serveur", nom: "!!antinuke", permission: "protection.guard.manage", description: "Configure l'anti-nuke (identique à `!!antiraid`) — droit `protection.guard.manage`." },
  { groupe: "Sécurité serveur", nom: "!!antiraid", permission: "protection.guard.manage", description: "Synonyme de `!!antinuke` — même moteur, aucun système parallèle." },
  { groupe: "Sécurité serveur", nom: "!!antilink [on/off]", permission: "protection.automod", description: "Anti-lien — droit `protection.automod`." },
  { groupe: "Sécurité serveur", nom: "!!antispam [on/off]", permission: "protection.automod", description: "Anti-spam/anti-flood — droit `protection.automod`." },
  {
    groupe: "Protection personnelle",
    nom: "!!panel",
    permission: null,
    description: "Tes protections personnelles (anti-ban/kick/timeout forcés...) — aucune permission requise.",
  },
  {
    groupe: "Autres",
    nom: "!!confess",
    permission: ["server.confessions.manage", "server.confessions.setup", "server.confessions.validation"],
    description:
      "Confessions anonymes. `setup` réservé à `server.confessions.setup`, `validation` à `server.confessions.validation`, Accepter/Refuser à `server.confessions.manage`.",
  },
  { groupe: "Autres", nom: "!!setclear", permission: "server.selfclear.manage", description: "Configure le nettoyage automatique (`<nom> clear`) — droit `server.selfclear.manage`." },
];

function autorisee(member, permission) {
  // Le paramètre était historiquement optionnel pour les appels directs de
  // buildProtectionHelpCard ; les messages réels passent toujours un membre.
  return !member || can(member, permission);
}

function buildProtectionHelpCard(prefix = "!!", member) {
  const container = new ContainerBuilder();
  const afficher = (texte) => texte.replaceAll("!!", prefix);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🛡️ Commandes "${prefix}"`));

  const modeDecouverte = member && !hasConfiguredAccess(member);
  const accessibles = COMMANDES.filter(
    (commande) => (!modeDecouverte || commande.nom.replace(/^!!/, "") === "help") && autorisee(member, commande.permission)
  );
  const groupes = [...new Set(accessibles.map((c) => c.groupe))];
  for (const groupe of groupes) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `**${groupe}**`,
          ...accessibles.filter((c) => c.groupe === groupe).map((c) => `**${afficher(c.nom)}** — ${afficher(c.description)}`),
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

  return message.channel.send(buildProtectionHelpCard(PREFIX, message.member)).catch(() => {});
}

module.exports = { handleProtectionHelpTextCommand, buildProtectionHelpCard, COMMANDES };
