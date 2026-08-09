const WELCOME_MESSAGES = ["sdk zinki ?", "wsh bien ?", "parle ou je t'encule ?"];

const randomWelcomeMessage = () =>
  WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)];

module.exports = { WELCOME_MESSAGES, randomWelcomeMessage };
