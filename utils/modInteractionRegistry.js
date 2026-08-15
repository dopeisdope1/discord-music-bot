// customId : préfixe:reste, ex "modpanel:antiraid:tiers" route vers le
// handler enregistré pour "modpanel". Espace de noms séparé des customId
// musique existants (spotify_join:*, music_*) — voir index.js.
const handlers = new Map();

function registerHandler(prefix, handler) {
  handlers.set(prefix, handler);
}

async function dispatch(interaction) {
  const isModal = interaction.isModalSubmit?.();
  const isComponent = interaction.isButton?.() || interaction.isAnySelectMenu?.();
  if (!isModal && !isComponent) return false;

  const prefix = interaction.customId.split(":")[0];
  const handler = handlers.get(prefix);
  if (!handler) return false;

  await handler(interaction);
  return true;
}

module.exports = { registerHandler, dispatch };
