process.env.DATA_DIR = require("os").tmpdir() + "/prot-" + Date.now();
const assert = require("assert");
const p = require("../utils/protections");

const keys = p.systems.map((s) => s.key);
assert.strictEqual(new Set(keys).size, keys.length, "clés uniques");
assert(keys.includes("anti-channel-delete") && keys.includes("anti-token-grab") && keys.includes("anti-alt"));

const g = "g1", k = "anti-channel-delete";
assert.strictEqual(p.record(g, k, "u", 0), false, "désactivé");
const sys = p.systems.find((s) => s.key === k);
sys.setState(g, { enabled: true, config: { count: 3, seconds: 10, sanction: "kick", logChannelId: "c1" } });
assert.strictEqual(p.record(g, k, "u", 0), false);
assert.strictEqual(p.record(g, k, "u", 5000), false);
assert.strictEqual(p.record(g, k, "u", 9000), true, "3 en 10 s");
assert.strictEqual(p.record(g, k, "u", 9500), false, "compteur remis à zéro");
assert.strictEqual(p.record(g, k, "v", 0), false);
assert.strictEqual(p.record(g, k, "v", 11000), false);
assert.strictEqual(p.record(g, k, "v", 22000), false, "hors fenêtre");
const st = sys.setState(g, { config: { sanction: "nope", count: 0, lockServer: true } });
assert.deepStrictEqual([st.config.sanction, st.config.count, st.config.lockServer, st.enabled], ["kick", 1, true, true]);
assert.strictEqual(p.systems.find((s) => s.key === "anti-ban").getState(g).enabled, false, "protections indépendantes");

// messages
const def = (id) => p.DEFS.find((d) => d.id === id);
const msg = (content, extra = {}) => ({ content, mentions: { users: { size: 0 }, roles: { size: 0 }, ...extra } });
assert(def("link").test(msg("va sur https://x.io")));
assert(!def("link").test(msg("salut")));
assert(def("mention-everyone").test(msg("hey @everyone")));
const fakeToken = ["a".repeat(26), "b".repeat(6), "c".repeat(30)].join(".");
assert(def("token-grab").test(msg(fakeToken)));
assert(def("badword").test(msg("sale CON"), { words: ["con"] }));
assert(def("mention-members").test(msg("x", { users: { size: 6 } }), { count: 5 }));
console.log("ok", keys.length, "protections");
