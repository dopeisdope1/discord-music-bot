const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");

// "=help" — index catégorisé des commandes du préfixe "=" (architecture 3
// préfixes : & = gestion, !! = sécurité, = = vocal), présentation calquée
// sur la capture de l'autre bot (catégories + nombre de commandes), mais
// remplie UNIQUEMENT avec les vraies commandes de CE bot. Purement
// informatif, aucune interaction : un tableau maintenu à la main. Les noms
// de commandes de l'autre bot (reset/settings/sys/wakeup/dog/follow/pv/
// pvlist/pvclear...) n'existent pas ici et ne sont donc PAS inventés ;
// "Private" (salons vocaux privés/temporaires) a été volontairement
// désactivé — voir TEMP_VOICE_DISABLED dans index.js.
const CATEGORIES = [
  {
    nom: "Administration",
    emoji: "🛡️",
    commandes: [
      { nom: "=add <@membre>", description: "Ouvre la carte d'octroi de permissions individuelles (catalogue complet)." },
      { nom: "=owner <@membre>", description: "Identique à `=add` — même carte \"Owner\" d'octroi de permissions." },
    ],
  },
  {
    nom: "Voice",
    emoji: "🎙️",
    commandes: [
      { nom: "=mute <@membre>", description: "Mute vocal Discord natif (distinct du mute-rôle punitif de `&mute`)." },
      { nom: "=unmute <@membre>", description: "Lève ce mute vocal." },
      { nom: "=deaf <@membre>", description: "Sourdine vocale native." },
      { nom: "=undeaf <@membre>", description: "Lève cette sourdine." },
      { nom: "=disconnect <@membre>", description: "Expulse un membre du vocal." },
      { nom: "=mv <@membre> #salon", description: "Déplace un membre vers un salon vocal (alias : `=move`)." },
      { nom: "=join <@membre>", description: "Te déplace, TOI, dans le salon vocal de ce membre." },
      { nom: "=find <@membre>", description: "Indique dans quel salon vocal se trouve un membre." },
      { nom: "=bringall", description: "Rassemble tout le monde dans ton salon vocal actuel." },
      { nom: "=wakeup <@membre>", description: "\"Réveille\" un membre en le faisant rebondir vers un autre salon puis revenir." },
    ],
  },
];

function buildVoiceHelpCard() {
  const total = CATEGORIES.reduce((n, c) => n + c.commandes.length, 0);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔊 Commandes \"=\"\n${total} commandes vocales`));

  for (const cat of CATEGORIES) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `### ${cat.emoji} ${cat.nom} — ${cat.commandes.length} commande${cat.commandes.length > 1 ? "s" : ""}`,
          ...cat.commandes.map((c) => `**${c.nom}**\n${c.description}`),
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

  return message.channel.send(buildVoiceHelpCard()).catch(() => {});
}

module.exports = { handleVoiceHelpTextCommand, buildVoiceHelpCard, CATEGORIES };
