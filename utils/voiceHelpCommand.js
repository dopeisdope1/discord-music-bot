const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");

// "=help" — index des commandes sur le préfixe "=" (architecture 3
// préfixes : & = modération, !! = sécurité, = = vocal), même patron que
// utils/protectionHelpCommand.js ("!!help") : un tableau maintenu à la
// main, purement informatif, aucune interaction. "=add" (octroi de
// permissions individuelles, utils/serverAdminCommands.js) partage ce
// préfixe mais n'a AUCUN rapport avec le vocal — listé à part pour ne pas
// laisser croire que c'est une commande vocale de plus.
const COMMANDES = [
  { nom: "=owner <@membre>", description: "Transfère la propriété de TON salon vocal temporaire à ce membre (doit y être présent)." },
  { nom: "=lock", description: "Verrouille ton salon (personne ne peut plus le rejoindre sans y être déjà, ou sans `=wl`/`&voc add`)." },
  { nom: "=unlock", description: "Déverrouille ton salon." },
  { nom: "=disconnect <@membre>", description: "Expulse un membre de ton salon (doit y être présent)." },
  { nom: "=mute <@membre>", description: "Mute vocal Discord natif dans ton salon (distinct du mute-rôle punitif de `&mute`)." },
  { nom: "=unmute <@membre>", description: "Lève ce mute vocal." },
  { nom: "=deaf <@membre>", description: "Sourdine vocale native dans ton salon." },
  { nom: "=undeaf <@membre>", description: "Lève cette sourdine." },
  { nom: "=move <@membre>", description: "Déplace un membre connecté ailleurs sur le serveur DANS ton salon (ne donne ni propriété, ni accès permanent)." },
  {
    nom: "=wl [@membre]",
    description: "Liste de confiance PERMANENTE : appliquée automatiquement à chacun de tes futurs salons (contrairement à `&voc add`, qui ne dure que le salon courant). Sans argument, affiche ta liste.",
  },
  { nom: "=unwl <@membre>", description: "Retire de cette liste de confiance permanente." },
  { nom: "=vc", description: "Ouvre le centre de contrôle de ton salon, sans avoir à passer par le salon-panneau partagé." },
  { nom: "=panel", description: "Raccourci direct vers `&panel` > Vocaux (configuration du salon générateur) — droit `server.voice.manage`." },
  { nom: "=add <@membre>", description: "Sans rapport avec le vocal — octroi de permissions individuelles du catalogue (voir `!!help`/`&help` pour le reste des permissions)." },
];

function buildVoiceHelpCard() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🔊 Commandes \"=\""));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Toutes agissent sur TON salon vocal temporaire actuel (sauf `=add`, sans rapport) — il faut en être le propriétaire ACTUEL."
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(COMMANDES.map((c) => `**${c.nom}** — ${c.description}`).join("\n\n"))
  );
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

module.exports = { handleVoiceHelpTextCommand, buildVoiceHelpCard };
