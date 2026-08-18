"use strict";

const fs = require("node:fs");
const path = require("node:path");
const guardEngine = require("./guardEngine");

const DEFINITIONS_DIR = path.join(__dirname, "definitions");

let loaded = false;

// Call once before any client.login() — registers every *.guard.js file with
// the shared guardEngine so attach(client, identity) has something to fan out to.
function loadAndRegister() {
    if (loaded) return;
    loaded = true;

    if (!fs.existsSync(DEFINITIONS_DIR)) return;

    const files = fs.readdirSync(DEFINITIONS_DIR).filter((f) => f.endsWith(".guard.js"));
    for (const file of files) {
        const def = require(path.join(DEFINITIONS_DIR, file));
        guardEngine.register(def);
    }
}

module.exports = { loadAndRegister };
