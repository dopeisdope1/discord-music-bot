"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EVENTS_DIR = path.join(__dirname, "..", "events");

let cache = null;

// An event file must export { name (a discord.js Events value), execute(client, identity, ...args), once? }.
function loadEvents() {
    if (cache) return cache;
    if (!fs.existsSync(EVENTS_DIR)) return (cache = []);

    cache = fs
        .readdirSync(EVENTS_DIR)
        .filter((f) => f.endsWith(".event.js"))
        .map((f) => require(path.join(EVENTS_DIR, f)))
        .filter((evt) => evt && evt.name && typeof evt.execute === "function");

    return cache;
}

function attachEvents(client, identity) {
    for (const evt of loadEvents()) {
        const handler = (...args) => evt.execute(client, identity, ...args);
        if (evt.once) {
            client.once(evt.name, handler);
        } else {
            client.on(evt.name, handler);
        }
    }
}

module.exports = { attachEvents, loadEvents };
