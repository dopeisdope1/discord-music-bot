class BotError extends Error {
  constructor(message) {
    super(message);
    this.name = "BotError";
  }
}

class UsageError extends BotError {
  constructor(usage) {
    super(`Utilisation : \`${usage}\``);
    this.name = "UsageError";
  }
}

class PermissionError extends BotError {
  constructor(message = "Permissions insuffisantes pour cette commande.") {
    super(message);
    this.name = "PermissionError";
  }
}

module.exports = { BotError, UsageError, PermissionError };
