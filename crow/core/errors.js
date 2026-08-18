"use strict";

class BotError extends Error {
    constructor(message) {
        super(message);
        this.name = "BotError";
    }
}

class UsageError extends BotError {
    constructor(message) {
        super(message);
        this.name = "UsageError";
    }
}

class PermissionError extends BotError {
    constructor(message = "Permissions insuffisantes pour cette commande.") {
        super(message);
        this.name = "PermissionError";
    }
}

class NotConfiguredError extends BotError {
    constructor(message = "Cette fonctionnalité n'est pas configurée.") {
        super(message);
        this.name = "NotConfiguredError";
    }
}

module.exports = { BotError, UsageError, PermissionError, NotConfiguredError };
