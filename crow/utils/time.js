"use strict";

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function parseDuration(input) {
    if (!input) return null;
    const match = String(input).trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
    if (!match) return null;
    const [, amount, unit] = match;
    return Number(amount) * UNITS[unit.toLowerCase()];
}

function formatDuration(ms) {
    if (ms <= 0) return "0s";
    const units = [
        ["j", 86_400_000],
        ["h", 3_600_000],
        ["m", 60_000],
        ["s", 1000],
    ];
    const parts = [];
    let remaining = ms;
    for (const [label, unitMs] of units) {
        const value = Math.floor(remaining / unitMs);
        if (value > 0) {
            parts.push(`${value}${label}`);
            remaining -= value * unitMs;
        }
    }
    return parts.slice(0, 2).join(" ") || "0s";
}

module.exports = { parseDuration, formatDuration };
