"use strict";

function chunk(array, size) {
    const out = [];
    for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
    return out;
}

function listField(items, { empty = "Aucun.", limit = 25 } = {}) {
    if (!items.length) return empty;
    const shown = items.slice(0, limit).join("\n");
    return items.length > limit ? `${shown}\n… et ${items.length - limit} de plus` : shown;
}

module.exports = { chunk, listField };
