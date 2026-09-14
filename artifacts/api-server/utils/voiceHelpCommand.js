const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { can, hasConfiguredAccess } = require("./permissions/engine");

// "=help" — index catégorisé des commandes du préfixe "=" (architecture 4
// préfixes : & = gestion, - = modération, !! = sécurité, = = vocal/owner),
// présentation calquée
// sur la capture de l'autre bot (catégories + nombre de commandes), mais
// remplie UNIQUEMENT avec les vraies commandes de CE bot. Purement
// informatif, aucune interaction : un tableau maintenu à la main. Les noms
// de commandes de l'autre bot (reset/settings/sys/wakeup/dog/follow/pv/
// pvlist/pvclear...) n'existent pas ici et ne sont donc PAS inventés ;
// Les commandes de ce catalogue concernent uniquement la modération vocale
// ordinaire ; aucun système de salons privés ou créés automatiquement n'est
// proposé.
const CATEGORIES = [
  {
    nom: "Administration",
    emoji: "🛡️",
    commandes: [
      { nom: "=help", permission: null, description: "Affiche cette aide." },
      { nom: "=add <@membre>", permission: "panel.permissions.manage", description: "Ouvre la carte \"Owner\" pour accorder ou retirer chaque accès vocal individuellement." },
      { nom: "=owner <@membre>", permission: "panel.permissions.manage", description: "Bascule tous les accès du préfixe \"=\" : accorde les commandes vocales manquantes ou retire l'accès vocal complet." },
    ],
  },
  {
    nom: "Voice",
    emoji: "🎙️",
    commandes: [
      { nom: "=mute <@membre>", permission: "voice.mute", description: "Mute vocal Discord natif (distinct du mute-rôle punitif de `&mute`)." },
      { nom: "=unmute <@membre>", permission: "voice.unmute", description: "Lève ce mute vocal." },
      { nom: "=deaf <@membre>", permission: "voice.deaf", description: "Sourdine vocale native." },
      { nom: "=undeaf <@membre>", permission: "voice.undeaf", description: "Lève cette sourdine." },
      { nom: "=disconnect <@membre>", permission: "voice.disconnect", description: "Expulse un membre du vocal." },
      { nom: "=mv <@membre> #salon", permission: "voice.mv", description: "Déplace un membre vers un salon vocal (alias : `=move`)." },
      { nom: "=join <@membre>", permission: "voice.join", description: "Te déplace, TOI, dans le salon vocal de ce membre." },
      { nom: "=find <@membre>", permission: "voice.find", description: "Indique dans quel salon vocal se trouve un membre." },
      { nom: "=bringall", permission: "voice.bringall", description: "Rassemble tout le monde dans ton salon vocal actuel." },
      { nom: "=wakeup <@membre>", permission: "voice.wakeup", description: "\"Réveille\" un membre en le faisant rebondir vers un autre salon puis revenir." },
    ],
  },
];

function autorisee(member, permission) {
  return !member || can(member, permission);
}

function buildVoiceHelpCard(prefix = "=", member) {
  const modeDecouverte = member && !hasConfiguredAccess(member);
  const categories = CATEGORIES.map((category) => ({
    ...category,
    commandes: category.commandes.filter(
      (commande) => (!modeDecouverte || commande.nom.replace(/^=/, "") === "help") && autorisee(member, commande.permission)
    ),
  })).filter((category) => category.commandes.length);
  const total = categories.reduce((n, c) => n + c.commandes.length, 0);
  const container = new ContainerBuilder();
  const afficher = (texte) => texte.replaceAll("=", prefix);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔊 Commandes "${prefix}"\n${total} commandes vocales`));

  for (const cat of categories) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `### ${cat.emoji} ${cat.nom} — ${cat.commandes.length} commande${cat.commandes.length > 1 ? "s" : ""}`,
          ...cat.commandes.map((c) => `**${afficher(c.nom)}**\n${afficher(c.description)}`),
        ].join("\n")
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function handleVoiceHelpTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { owner: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "help") return; // mot inconnu sur ce préfixe : silence

  return message.channel.send(buildVoiceHelpCard(PREFIX, message.member)).catch(() => {});
}

module.exports = { handleVoiceHelpTextCommand, buildVoiceHelpCard, CATEGORIES };
