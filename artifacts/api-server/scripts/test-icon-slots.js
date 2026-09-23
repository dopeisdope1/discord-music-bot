/**
 * Vérifie l'extension de "&emoji" aux icônes de design (utils/emojis.js) :
 * un slot "icon:XXX" par clé du registre, personnalisable comme n'importe
 * quel groupe d'aide, avec repli sur la valeur par défaut du registre.
 *
 * Lancement : node scripts/test-icon-slots.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "icon-slots-test-"));

const { EMOJI } = require("../utils/emojis");
const { SLOTS, iconDe } = require("../utils/emojiSlots");
const categoryEmojiStore = require("../utils/categoryEmojiStore");
const { buildStatusEmbed } = require("../utils/statusEmbed");

let reussis = 0;
function cas(nom, fn) {
  try {
    fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const GUILD = "guild-icon-test";

console.log("Slots \"icon:*\" — un par clé de utils/emojis.js :");

cas("chaque clé de EMOJI a un slot icon:<clé> correspondant", () => {
  for (const cle of Object.keys(EMOJI)) {
    assert.ok(
      SLOTS.some((s) => s.key === `icon:${cle}`),
      `slot "icon:${cle}" manquant — utils/emojiSlots.js::GROUPES_ICONES doit être tenu à jour avec utils/emojis.js`
    );
  }
});

cas("aucun groupe d'icônes ni catégorie existante ne dépasse 25 options (limite Discord d'un select menu)", () => {
  const parCategorie = new Map();
  for (const slot of SLOTS) {
    const liste = parCategorie.get(slot.categorie) || [];
    liste.push(slot);
    parCategorie.set(slot.categorie, liste);
  }
  for (const [categorie, liste] of parCategorie) {
    assert.ok(liste.length <= 25, `catégorie "${categorie}" a ${liste.length} slots, au-dessus de la limite de 25`);
  }
});

cas("iconDe() sans personnalisation retombe sur la valeur de utils/emojis.js", () => {
  assert.strictEqual(iconDe(GUILD, "SUCCESS"), EMOJI.SUCCESS);
  assert.strictEqual(iconDe(GUILD, "BAN"), EMOJI.BAN);
});

cas("iconDe() reflète une personnalisation posée via categoryEmojiStore", () => {
  categoryEmojiStore.set(GUILD, "icon:SUCCESS", "🎉");
  assert.strictEqual(iconDe(GUILD, "SUCCESS"), "🎉");
  categoryEmojiStore.reset(GUILD, "icon:SUCCESS");
  assert.strictEqual(iconDe(GUILD, "SUCCESS"), EMOJI.SUCCESS);
});

cas("iconDe() sur une clé inconnue ne lève pas, renvoie null", () => {
  assert.strictEqual(iconDe(GUILD, "N_EXISTE_PAS"), null);
});

console.log("\nbuildStatusEmbed — personnalisable via options.guildId, inchangé sans lui :");

function descriptionDe(embed) {
  const data = typeof embed.toJSON === "function" ? embed.toJSON() : embed.data;
  return data.description || "";
}

cas("sans guildId, le comportement historique est préservé (icône par défaut)", () => {
  const embed = buildStatusEmbed("success", "test");
  assert.ok(descriptionDe(embed).includes(EMOJI.SUCCESS));
});

cas("avec guildId, une icône personnalisée de icon:SUCCESS est utilisée", () => {
  categoryEmojiStore.set(GUILD, "icon:SUCCESS", "🎉");
  const embed = buildStatusEmbed("success", "test", { guildId: GUILD });
  assert.ok(descriptionDe(embed).includes("🎉"));
  categoryEmojiStore.reset(GUILD, "icon:SUCCESS");
});

cas("avec guildId mais sans personnalisation, retombe sur l'icône par défaut", () => {
  const embed = buildStatusEmbed("error", "test", { guildId: GUILD });
  assert.ok(descriptionDe(embed).includes(EMOJI.ERROR));
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? ", des échecs sont survenus." : ", tout est vert."}`);

