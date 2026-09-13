const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { getPrefixes } = require("./prefixStore");

// "=help" — index des commandes sur le préfixe "=" (architecture 3
// préfixes : & = modération, !! = sécurité, = = vocal), même patron que
// utils/protectionHelpCommand.js ("!!help") : un tableau maintenu à la
// main, purement informatif, aucune interaction. Un simple catalogue de
// commandes de modération VOCALE réelles (droit `server.voice.manage`,
// utils/serverExtra.js) — sur N'IMPORTE QUEL membre en vocal, aucune notion
// de salon "à soi" ni de propriété. "=add" (octroi de permissions
// individuelles, utils/serverAdminCommands.js) partage ce préfixe mais n'a
// AUCUN rapport avec le vocal — listé à part pour ne pas laisser croire que
// c'est une commande vocale de plus.
const COMMANDES = [
  { nom: "=mute <@membre>", description: "Mute vocal Discord natif (distinct du mute-rôle punitif de `&mute`) — droit `server.voice.manage`." },
  { nom: "=unmute <@membre>", description: "Lève ce mute vocal." },
  { nom: "=deaf <@membre>", description: "Sourdine vocale native." },
  { nom: "=undeaf <@membre>", description: "Lève cette sourdine." },
  { nom: "=disconnect <@membre>", description: "Expulse un membre du vocal (identique à `&voicekick`)." },
  { nom: "=move <@membre> #salon", description: "Déplace un membre vers un salon vocal (identique à `&mv`)." },
  { nom: "=add <@membre>", description: "Sans rapport avec le vocal — octroi de permissions individuelles du catalogue (voir `!!help`/`&help` pour le reste des permissions)." },
];

function buildVoiceHelpCard() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🔊 Commandes \"=\""));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "Agissent sur N'IMPORTE QUEL membre actuellement en vocal (sauf `=add`, sans rapport) — droit `server.voice.manage`."
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
