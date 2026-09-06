/**
 * Vérifie &class/&classes (utils/classSelect.js, utils/classRolesStore.js) :
 * sélection de classe par menu déroulant + boutons Cancel/Submit, dont la
 * liste des choix vient UNIQUEMENT de rôles Discord déjà existants,
 * whitelistés par un admin via &classes add/del — jamais une liste codée en
 * dur.
 *
 * Chaque cas utilise son PROPRE guildId (jamais partagé) : classRolesStore
 * persiste réellement sur disque comme en prod, donc réutiliser un même
 * guildId entre cas ferait fuiter l'état de l'un vers l'autre.
 *
 * Lancement : node scripts/test-class-select.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "classselect-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const classRolesStore = require("../utils/classRolesStore");
const { buildClassPanel, openClassSelect, handleClassInteraction, classesAdd, classesDel, classesList } = require("../utils/classSelect");

function makeRole(id, name) {
  return {
    id,
    name,
    toString() {
      return `<@&${this.id}>`;
    },
  };
}

let guildCounter = 0;
function makeGuild(roles) {
  const id = `guild-${++guildCounter}`;
  return { id, roles: { cache: new Collection(roles.map((r) => [r.id, r])) } };
}

function resolveIds(input) {
  if (input == null) return [];
  const list = Array.isArray(input) ? input : typeof input.values === "function" ? [...input.values()] : [input];
  return list.map((item) => (typeof item === "string" ? item : item.id));
}

function makeMember(id, guild, initialRoleIds = []) {
  const cache = new Collection(initialRoleIds.map((rid) => [rid, guild.roles.cache.get(rid) || { id: rid }]));
  const roles = {
    cache,
    add: async function (input) {
      for (const rid of resolveIds(input)) cache.set(rid, guild.roles.cache.get(rid) || { id: rid });
    },
    remove: async function (input) {
      for (const rid of resolveIds(input)) cache.delete(rid);
    },
  };
  return { id, guild, roles };
}

function makeMessage(guild, member, { mentionedRole = null } = {}) {
  const replies = [];
  return {
    author: { id: member.id, tag: `${member.id}#0001` },
    member,
    guild,
    mentions: { roles: new Collection(mentionedRole ? [[mentionedRole.id, mentionedRole]] : []) },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

function makeInteraction({ customId, userId, guild, member, values }) {
  const updates = [];
  const replies = [];
  return {
    customId,
    user: { id: userId },
    guild,
    member,
    values: values || [],
    update: async (p) => {
      updates.push(p);
      return {};
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _updates: updates,
    _replies: replies,
  };
}

function panelJson(panel) {
  return panel.components[0].toJSON();
}
function selectRow(json) {
  return json.components.find((c) => c.type === 1 && c.components[0]?.type === 3);
}
function buttonRow(json) {
  return json.components.find((c) => c.type === 1 && c.components[0]?.type === 2);
}
function lastUpdateJson(interaction) {
  return interaction._updates.at(-1).components[0].toJSON();
}

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log("classRolesStore — persistance de la whitelist :");

  await cas("addRole ajoute, renvoie false si déjà présent", () => {
    const guild = makeGuild([]);
    assert.strictEqual(classRolesStore.addRole(guild.id, "role-x"), true);
    assert.strictEqual(classRolesStore.addRole(guild.id, "role-x"), false);
    assert.deepStrictEqual(classRolesStore.getRoleIds(guild.id), ["role-x"]);
  });

  await cas("removeRole retire, renvoie false si absent, n'affecte pas une autre guilde", () => {
    const guild = makeGuild([]);
    classRolesStore.addRole(guild.id, "role-x");
    assert.strictEqual(classRolesStore.removeRole("guilde-inexistante", "role-x"), false);
    assert.strictEqual(classRolesStore.removeRole(guild.id, "role-x"), true);
    assert.deepStrictEqual(classRolesStore.getRoleIds(guild.id), []);
  });

  console.log("\n&classes add/del/list — whitelist de rôles déjà existants :");

  await cas("classes add whiteliste un rôle EXISTANT du serveur, jamais inventé", async () => {
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([mage]);
    const admin = makeMember("owner-1", guild);
    const msg = makeMessage(guild, admin, { mentionedRole: mage });
    await classesAdd(null, msg, []);
    assert.ok(classRolesStore.getRoleIds(guild.id).includes(mage.id));
    assert.ok(msg._replies[0].embeds[0].data.description.includes("Mage"));
  });

  await cas("classes add refuse @everyone comme classe", async () => {
    const guild = makeGuild([]);
    const admin = makeMember("owner-1", guild);
    const everyone = makeRole(guild.id, "@everyone"); // @everyone partage l'ID de la guilde
    const msg = makeMessage(guild, admin, { mentionedRole: everyone });
    await classesAdd(null, msg, []);
    assert.ok(!classRolesStore.getRoleIds(guild.id).includes(guild.id));
  });

  await cas("classes add/del/list sont muettes sans la permission server.classes.manage", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const guild = makeGuild([warrior]);
    const nonAdmin = makeMember("membre-lambda", guild);
    const msg = makeMessage(guild, nonAdmin, { mentionedRole: warrior });
    await classesAdd(null, msg, []);
    await classesDel(null, msg, []);
    await classesList(null, msg);
    assert.strictEqual(msg._replies.length, 0);
    assert.deepStrictEqual(classRolesStore.getRoleIds(guild.id), []);
  });

  await cas("classes list affiche les rôles configurés", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([warrior, mage]);
    classRolesStore.addRole(guild.id, warrior.id);
    classRolesStore.addRole(guild.id, mage.id);
    const admin = makeMember("owner-1", guild);
    const msg = makeMessage(guild, admin);
    await classesList(null, msg);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.ok(desc.includes(warrior.id) && desc.includes(mage.id));
  });

  await cas("classes del retire un rôle whitelisté", async () => {
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([mage]);
    classRolesStore.addRole(guild.id, mage.id);
    const admin = makeMember("owner-1", guild);
    const msg = makeMessage(guild, admin, { mentionedRole: mage });
    await classesDel(null, msg, []);
    assert.ok(!classRolesStore.getRoleIds(guild.id).includes(mage.id));
  });

  console.log("\n&class — panneau dynamique, aucune classe codée en dur :");

  await cas("sans aucune classe configurée, le panneau le dit et n'affiche aucun composant interactif", async () => {
    const guild = makeGuild([makeRole("role-warrior", "Warrior")]); // rôle existant mais PAS whitelisté
    const member = makeMember("p1", guild);
    const json = panelJson(buildClassPanel(guild, member, "p1"));
    assert.ok(!selectRow(json) && !buttonRow(json));
    assert.ok(json.components[0].content.includes("Aucune classe n'est configurée"));
  });

  await cas("avec des classes configurées, le menu liste EXACTEMENT les rôles whitelistés (rien d'inventé)", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([warrior, mage]);
    classRolesStore.addRole(guild.id, warrior.id);
    classRolesStore.addRole(guild.id, mage.id);
    const member = makeMember("p1", guild);
    const json = panelJson(buildClassPanel(guild, member, "p1"));
    const select = selectRow(json).components[0];
    assert.deepStrictEqual(
      select.options.map((o) => o.value).sort(),
      [warrior.id, mage.id].sort()
    );
  });

  await cas("aucune sélection initiale : Submit désactivé (empêche la soumission vide)", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const guild = makeGuild([warrior]);
    classRolesStore.addRole(guild.id, warrior.id);
    const member = makeMember("p1", guild);
    const json = panelJson(buildClassPanel(guild, member, "p1"));
    const submit = buttonRow(json).components[1];
    assert.strictEqual(submit.disabled, true);
  });

  await cas("un membre qui a déjà une classe la voit pré-sélectionnée, Submit activé", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([warrior, mage]);
    classRolesStore.addRole(guild.id, warrior.id);
    classRolesStore.addRole(guild.id, mage.id);
    const member = makeMember("p1", guild, [warrior.id]);
    const json = panelJson(buildClassPanel(guild, member, "p1"));
    const select = selectRow(json).components[0];
    assert.strictEqual(select.options.find((o) => o.default)?.value, warrior.id);
    const submit = buttonRow(json).components[1];
    assert.strictEqual(submit.disabled, false);
    assert.ok(submit.custom_id.endsWith(`:${warrior.id}`));
  });

  console.log("\n&class — interactions (select/submit/cancel) :");

  await cas("choisir une option dans le menu ne change RIEN tant que Submit n'est pas cliqué", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([warrior, mage]);
    classRolesStore.addRole(guild.id, warrior.id);
    classRolesStore.addRole(guild.id, mage.id);
    const member = makeMember("p1", guild);
    const interaction = makeInteraction({ customId: "class:select:p1", userId: "p1", guild, member, values: [mage.id] });
    await handleClassInteraction(interaction);
    assert.strictEqual(member.roles.cache.size, 0, "aucune classe ne doit être enregistrée avant Submit");
    const json = lastUpdateJson(interaction);
    const submit = buttonRow(json).components[1];
    assert.strictEqual(submit.disabled, false);
    assert.ok(submit.custom_id.endsWith(`:${mage.id}`), "le rôle choisi doit être encodé dans Submit, pas gardé en mémoire serveur");
  });

  await cas('submit avec le sentinel "aucune sélection" est rejeté proprement (défense en profondeur)', async () => {
    const guild = makeGuild([]);
    const member = makeMember("p1", guild);
    const interaction = makeInteraction({ customId: "class:submit:p1:_", userId: "p1", guild, member });
    await handleClassInteraction(interaction);
    assert.strictEqual(interaction._replies[0].content, "Choisis une classe avant de valider.");
    assert.strictEqual(member.roles.cache.size, 0);
  });

  await cas("submit assigne la classe choisie et retire l'ancienne (une seule classe à la fois)", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([warrior, mage]);
    classRolesStore.addRole(guild.id, warrior.id);
    classRolesStore.addRole(guild.id, mage.id);
    const member = makeMember("p1", guild, [warrior.id]);
    const interaction = makeInteraction({ customId: `class:submit:p1:${mage.id}`, userId: "p1", guild, member });
    await handleClassInteraction(interaction);
    assert.ok(member.roles.cache.has(mage.id) && !member.roles.cache.has(warrior.id));
    const json = lastUpdateJson(interaction);
    assert.ok(json.components[0].content.includes("Mage"));
    assert.ok(!selectRow(json) && !buttonRow(json), "panneau final : plus de composants pour empêcher une double validation");
  });

  await cas("re-soumettre la classe déjà possédée ne touche pas Discord et confirme simplement", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const guild = makeGuild([warrior]);
    classRolesStore.addRole(guild.id, warrior.id);
    const member = makeMember("p1", guild, [warrior.id]);
    member.roles.add = async () => assert.fail("ne doit pas être appelé");
    member.roles.remove = async () => assert.fail("ne doit pas être appelé");
    const interaction = makeInteraction({ customId: `class:submit:p1:${warrior.id}`, userId: "p1", guild, member });
    await handleClassInteraction(interaction);
    assert.ok(lastUpdateJson(interaction).components[0].content.includes("Warrior"));
  });

  await cas("échec Discord (hiérarchie/permissions) : message d'erreur clair, panneau inchangé", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const guild = makeGuild([warrior]);
    classRolesStore.addRole(guild.id, warrior.id);
    const member = makeMember("p1", guild);
    member.roles.add = async () => {
      throw new Error("Missing Permissions");
    };
    const interaction = makeInteraction({ customId: `class:submit:p1:${warrior.id}`, userId: "p1", guild, member });
    await handleClassInteraction(interaction);
    assert.strictEqual(interaction._replies[0].content, "Discord a refusé : Missing Permissions");
    assert.strictEqual(interaction._updates.length, 0);
  });

  await cas("classe retirée de la whitelist entre l'ouverture et le submit : erreur propre, pas de crash", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const guild = makeGuild([warrior]); // existe sur le serveur, mais jamais whitelisté
    const member = makeMember("p1", guild);
    const interaction = makeInteraction({ customId: `class:submit:p1:${warrior.id}`, userId: "p1", guild, member });
    await handleClassInteraction(interaction);
    assert.strictEqual(interaction._replies[0].content, "Cette classe n'existe plus, relance `&class`.");
  });

  await cas("cancel n'enregistre rien et n'appelle aucune API de rôle", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([warrior, mage]);
    classRolesStore.addRole(guild.id, warrior.id);
    classRolesStore.addRole(guild.id, mage.id);
    const member = makeMember("p1", guild);
    member.roles.add = async () => assert.fail("cancel ne doit jamais toucher aux rôles");
    const interaction = makeInteraction({ customId: "class:cancel:p1", userId: "p1", guild, member, values: [mage.id] });
    await handleClassInteraction(interaction);
    assert.strictEqual(member.roles.cache.size, 0);
    assert.ok(lastUpdateJson(interaction).components[0].content.includes("Annulé"));
  });

  await cas("une interaction qui n'appartient pas à l'auteur est rejetée en ephemeral, sans toucher au panneau", async () => {
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([mage]);
    classRolesStore.addRole(guild.id, mage.id);
    const member = makeMember("p1", guild);
    const intrus = makeInteraction({
      customId: `class:submit:p1:${mage.id}`,
      userId: "intrus",
      guild,
      member: makeMember("intrus", guild),
      values: [],
    });
    await handleClassInteraction(intrus);
    assert.strictEqual(intrus._replies[0].content, "Ce menu ne t'appartient pas.");
    assert.ok(intrus._replies[0].flags, "doit être ephemeral");
    assert.strictEqual(intrus._updates.length, 0);
    assert.strictEqual(member.roles.cache.size, 0);
  });

  console.log("\n&class — plusieurs utilisateurs en même temps, sans interférence :");

  await cas("deux membres ouvrent &class et valident des classes différentes sans se marcher dessus", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const mage = makeRole("role-mage", "Mage");
    const guild = makeGuild([warrior, mage]);
    classRolesStore.addRole(guild.id, warrior.id);
    classRolesStore.addRole(guild.id, mage.id);
    const p1 = makeMember("p1", guild);
    const p2 = makeMember("p2", guild);

    const i1 = makeInteraction({ customId: `class:submit:p1:${warrior.id}`, userId: "p1", guild, member: p1 });
    const i2 = makeInteraction({ customId: `class:submit:p2:${mage.id}`, userId: "p2", guild, member: p2 });
    await Promise.all([handleClassInteraction(i1), handleClassInteraction(i2)]);

    assert.ok(p1.roles.cache.has(warrior.id) && !p1.roles.cache.has(mage.id));
    assert.ok(p2.roles.cache.has(mage.id) && !p2.roles.cache.has(warrior.id));
  });

  await cas("le panneau ouvert par &class encode bien l'auteur du message, pas un autre membre présent", async () => {
    const warrior = makeRole("role-warrior", "Warrior");
    const guild = makeGuild([warrior]);
    classRolesStore.addRole(guild.id, warrior.id);
    const member = makeMember("p1", guild);
    const msg = makeMessage(guild, member);
    await openClassSelect(null, msg);
    const json = msg._replies[0].components[0].toJSON();
    assert.ok(selectRow(json).components[0].custom_id.endsWith(":p1"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
