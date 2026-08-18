"use strict";

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { attachEvents } = require("./eventLoader");
const guardEngine = require("../guard/guardEngine");

function createClient(identity) {
    const intents = (identity.intents || []).map((name) => {
        if (!(name in GatewayIntentBits)) {
            throw new Error(`Unknown intent "${name}" for identity "${identity.key}"`);
        }
        return GatewayIntentBits[name];
    });

    const client = new Client({
        intents,
        partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember],
    });

    client.identity = identity;
    attachEvents(client, identity);
    guardEngine.attach(client, identity);

    return client;
}

module.exports = { createClient };
