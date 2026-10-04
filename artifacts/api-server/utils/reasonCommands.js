const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const banReasonsStore = require("./banReasonsStore");

// Gestion des raisons de ban PRÉDÉFINIES (utils/banReasonsStore.js),
// proposées par "-baninfo" ET "-zinkiller" (préfixées par "raisonid:").
// Une raison peut exiger une preuve ("obligatoire") avant confirmation —
// voir utils/zinkillerCommands.js. Gérées ici en texte (pas de panel dédié,
// même famille que -banreasons n'existait pas avant : ces fonctions
// n'étaient jamais appelées, aucune UI pour les gérer).
const PERMISSION = "moderation.ban";

const reply = (message, kind, text) => message.reply(buildStatusEmbed(kind, text, { guildId: message.guild.id }));

/** "-reasonadd <label> [obligatoire]" — "obligatoire" en dernier mot = preuve requise pour cette raison. */
async function reasonadd(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const dernier = (args[args.length - 1] || "").toLowerCase();
  const obligatoire = dernier === "obligatoire";
  const label = (obligatoire ? args.slice(0, -1) : args).join(" ").trim();
  if (!label) return reply(message, "error", "Indique un libellé : `reasonadd <libellé> [obligatoire]`.");

  const entry = banReasonsStore.add(message.guild.id, label, obligatoire);
  return reply(message, "success", `Raison **${entry.label}** ajoutée (\`${entry.id}\`)${obligatoire ? " — preuve obligatoire" : ""}.`);
}

/** "-reasondel <id>" */
async function reasondel(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const id = args[0];
  if (!id) return reply(message, "error", "Indique l'identifiant de la raison : `reasondel <id>` (voir `reasonlist`).");
  const removed = banReasonsStore.remove(message.guild.id, id);
  return reply(message, removed ? "success" : "error", removed ? "Raison retirée." : "Identifiant inconnu.");
}

/** "-reasonproof <id>" — bascule si cette raison exige une preuve. */
async function reasonproof(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const id = args[0];
  const entry = id ? banReasonsStore.get(message.guild.id, id) : null;
  if (!entry) return reply(message, "error", "Indique l'identifiant d'une raison existante : `reasonproof <id>` (voir `reasonlist`).");
  banReasonsStore.setRequiresProof(message.guild.id, id, !entry.requiresProof);
  return reply(message, "success", `Preuve ${!entry.requiresProof ? "désormais **obligatoire**" : "désormais **facultative**"} pour **${entry.label}**.`);
}

/** "-reasongrade <id> <grade>" — étiquette libre (ex: "Trust", "Sévère") attachée à cette raison, affichée sur la carte blacklist. Sans second argument : retire le grade. */
async function reasongrade(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const id = args[0];
  const entry = id ? banReasonsStore.get(message.guild.id, id) : null;
  if (!entry) return reply(message, "error", "Indique l'identifiant d'une raison existante : `reasongrade <id> [grade]` (voir `reasonlist`).");
  const grade = args.slice(1).join(" ").trim() || null;
  banReasonsStore.setGrade(message.guild.id, id, grade);
  return reply(message, "success", grade ? `Grade **${grade}** attaché à **${entry.label}**.` : `Grade retiré de **${entry.label}**.`);
}

/** "-reasonlist" */
async function reasonlist(client, message) {
  if (!can(message.member, PERMISSION)) return;
  const raisons = banReasonsStore.list(message.guild.id);
  if (!raisons.length) {
    return reply(message, "info", "Aucune raison prédéfinie (voir `reasonadd <libellé> [obligatoire]`).");
  }
  const lignes = raisons.map((r) => `\`${r.id}\` — **${r.label}**${r.grade ? ` — grade ${r.grade}` : ""}${r.requiresProof ? " (preuve obligatoire)" : ""}`);
  return reply(message, "info", lignes.join("\n"));
}

module.exports = { reasonadd, reasondel, reasonproof, reasongrade, reasonlist };
