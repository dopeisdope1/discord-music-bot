const fs = require("fs");
const path = require("path");

// Slots hiérarchiques "Permission N" par serveur — équivalent JSON du moteur
// de permissions (position, exclusive, cooldown, rôles/
// membres/commandes), stocké ici en JSON plutôt qu'en base pour pouvoir
// être sauvegardé/restauré via le salon "zinki-config" comme tout le reste
// de la config de ce bot (voir utils/configChannel.js) — survit ainsi aux
// redéploiements Railway sans dépendre d'un Volume monté.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "permissions.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[permissionsStore] échec de la sauvegarde :", err);
  }
}

// Toujours renormalisé — voir le commentaire équivalent dans muteStore.js
// (un {} vide venu du salon "zinki-config" ne doit pas être pris pour "déjà initialisé").
function ensureGuild(guildId) {
  const data = load();
  const defaults = { nextId: 1, slots: [] };
  data[guildId] = { ...defaults, ...data[guildId] };
  return data[guildId];
}

function listByGuild(guildId) {
  return [...ensureGuild(guildId).slots]
    .map((s) => (s.voiceActions ? s : { ...s, voiceActions: [] })) // slots d'avant l'ajout du champ
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

function get(guildId, slotId) {
  const slot = ensureGuild(guildId).slots.find((s) => s.id === slotId) || null;
  // `voiceActions` est arrivé après coup : les slots créés avant ne l'ont pas,
  // et les lire sans ce garde-fou casserait tout ce qui itère dessus.
  if (slot && !slot.voiceActions) slot.voiceActions = [];
  return slot;
}

// Cherche un slot par ID seul (sans connaître son guildId à l'avance) — les
// customId d'interaction ne portent que l'ID du slot, pas le guildId.
function findAnyGuild(slotId) {
  const data = load();
  for (const guildId of Object.keys(data)) {
    const slot = data[guildId].slots.find((s) => s.id === slotId);
    if (slot) return { guildId, slot };
  }
  return null;
}

function create(guildId, name) {
  const g = ensureGuild(guildId);
  const position = g.slots.length ? Math.max(...g.slots.map((s) => s.position)) + 1 : 1;
  const slot = {
    id: g.nextId++,
    name,
    position,
    exclusive: false,
    cooldownSeconds: null,
    roles: [],
    members: [],
    commands: [],
    // Actions vocales accordées par ce slot (voir utils/voiceAccess.js) :
    // "move" | "mute" | "deaf" | "disconnect".
    voiceActions: [],
  };
  g.slots.push(slot);
  save();
  return slot;
}

function setVoiceActions(guildId, slotId, actions) {
  const slot = get(guildId, slotId);
  if (!slot) return;
  slot.voiceActions = [...new Set(actions)];
  save();
}

function remove(guildId, slotId) {
  const g = ensureGuild(guildId);
  g.slots = g.slots.filter((s) => s.id !== slotId);
  save();
}

function update(guildId, slotId, patch) {
  const slot = get(guildId, slotId);
  if (!slot) return;
  Object.assign(slot, patch);
  save();
}

function rename(guildId, slotId, name) {
  update(guildId, slotId, { name });
}

function setExclusive(guildId, slotId, exclusive) {
  update(guildId, slotId, { exclusive: Boolean(exclusive) });
}

function setCooldown(guildId, slotId, seconds) {
  update(guildId, slotId, { cooldownSeconds: seconds });
}

function move(guildId, slotId, direction) {
  const g = ensureGuild(guildId);
  const slot = g.slots.find((s) => s.id === slotId);
  if (!slot) return;

  const sorted = [...g.slots].sort((a, b) => a.position - b.position);
  const idx = sorted.findIndex((s) => s.id === slotId);
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  const neighbor = sorted[neighborIdx];
  if (!neighbor) return;

  const tmp = slot.position;
  slot.position = neighbor.position;
  neighbor.position = tmp;
  save();
}

function addRole(guildId, slotId, roleId) {
  const slot = get(guildId, slotId);
  if (!slot || slot.roles.includes(roleId)) return;
  slot.roles.push(roleId);
  save();
}

function removeRole(guildId, slotId, roleId) {
  const slot = get(guildId, slotId);
  if (!slot) return;
  slot.roles = slot.roles.filter((r) => r !== roleId);
  save();
}

function addMember(guildId, slotId, userId) {
  const slot = get(guildId, slotId);
  if (!slot || slot.members.includes(userId)) return;
  slot.members.push(userId);
  save();
}

function removeMember(guildId, slotId, userId) {
  const slot = get(guildId, slotId);
  if (!slot) return;
  slot.members = slot.members.filter((m) => m !== userId);
  save();
}

function addCommand(guildId, slotId, commandName) {
  const slot = get(guildId, slotId);
  if (!slot || slot.commands.includes(commandName)) return;
  slot.commands.push(commandName);
  save();
}

function removeCommand(guildId, slotId, commandName) {
  const slot = get(guildId, slotId);
  if (!slot) return;
  slot.commands = slot.commands.filter((c) => c !== commandName);
  save();
}

// Tous les slots auxquels un membre a directement accès (par rôle ou ajout
// direct) — base du calcul de cascade, voir utils/permissionEngine.js.
function listForMember(guildId, userId, roleIds) {
  const all = listByGuild(guildId);
  const roleSet = new Set(roleIds);
  return all.filter((s) => s.members.includes(userId) || s.roles.some((r) => roleSet.has(r)));
}

function getRawGuildData(guildId) {
  return load()[guildId] || { nextId: 1, slots: [] };
}

function hydrateFromRemote(guildId, remoteData) {
  if (!remoteData) return;
  const data = load();
  data[guildId] = remoteData;
  save();
}

module.exports = {
  listByGuild,
  get,
  findAnyGuild,
  create,
  remove,
  rename,
  setExclusive,
  setCooldown,
  move,
  addRole,
  removeRole,
  addMember,
  removeMember,
  addCommand,
  removeCommand,
  setVoiceActions,
  listForMember,
  getRawGuildData,
  hydrateFromRemote,
};
