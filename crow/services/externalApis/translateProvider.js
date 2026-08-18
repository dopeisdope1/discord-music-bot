"use strict";

const { NotConfiguredError } = require("../../core/errors");

// No production-worthy unauthenticated translation endpoint exists — this stays
// a clearly-marked stub until TRANSLATE_API_KEY is set AND a provider is wired
// in below. The command layer (+translate) is built end-to-end against this
// function, so flipping it on later is a one-line change here, not a new command.
async function translate(text, targetLang) {
    const apiKey = process.env.TRANSLATE_API_KEY;
    if (!apiKey) {
        throw new NotConfiguredError(
            "Traduction non configurée — définis TRANSLATE_API_KEY dans .env pour l'activer."
        );
    }

    throw new NotConfiguredError(
        "TRANSLATE_API_KEY est défini mais aucun fournisseur n'est câblé — complète translateProvider.js avec l'appel HTTP réel."
    );
}

module.exports = { translate };
