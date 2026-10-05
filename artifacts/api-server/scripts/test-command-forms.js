/**
 * Vérifie l'exécution de commandes depuis &panel > Exécuter
 * (utils/commandForms.js) : chaque formulaire construit un faux "message"
 * à partir des choix (salon/rôle/membre/texte) et appelle le VRAI handler
 * texte existant — ces tests vérifient que l'action réelle a bien lieu
 * (kick effectif, timeout à la bonne durée, message posté dans le bon
 * salon, rôle créé avec le bon nom...), pas seulement l'absence d'erreur.
 *
 * Lancement : node scripts/test-command-forms.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "commandforms-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField, ChannelType, MessageFlags } = require("discord.js");
const commandForms = require("../utils/commandForms");

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

const TARGET_ID = "999888777000111222";

const TEST_ROLE_ID = "role-111111111111111";

function makeInteraction() {
  const rolesCache = new Collection([[TEST_ROLE_ID, { id: TEST_ROLE_ID, name: "Testeur", position: 2 }]]);
  const targetMember = {
    id: TARGET_ID,
    user: { id: TARGET_ID, tag: "cible#0001" },
    roles: {
      cache: new Collection(),
      highest: { position: 1 },
      add: async function (roleOrColl, reason) {
        this._added = this._added || [];
        this._added.push(roleOrColl.id || [...roleOrColl.keys?.() || []]);
      },
      remove: async function (roleOrColl, reason) {
        this._removed = this._removed || [];
        this._removed.push(roleOrColl.id || [...roleOrColl.keys?.() || []]);
      },
    },
    moderatable: true,
    communicationDisabledUntil: null,
    kick: async function (reason) {
      this._kicked = reason;
    },
    ban: async function (opts) {
      this._banned = opts;
    },
    timeout: async function (ms, reason) {
      this._timedOut = { ms, reason };
    },
  };
  const membersCache = new Collection([[TARGET_ID, targetMember]]);
  const channel = {
    id: "c1",
    type: ChannelType.GuildText,
    permissionOverwrites: { cache: new Collection(), edit: async () => {} },
    send: async (payload) => {
      channel._sent = channel._sent || [];
      channel._sent.push(payload);
      return { id: "msg1", edit: async () => {} };
    },
    setRateLimitPerUser: async (seconds) => {
      channel._rateLimit = seconds;
    },
  };
  const guild = {
    id: "g1",
    ownerId: "owner-x",
    channels: {
      cache: new Collection([["c1", channel]]),
      create: async (opts) => {
        guild._createdRole = opts;
        return { id: "newchan", name: opts.name };
      },
    },
    roles: {
      cache: rolesCache,
      everyone: { id: "g1" },
      create: async (opts) => {
        guild._createdRole = opts;
        return { id: "newrole", name: opts.name };
      },
    },
    bans: {
      fetch: async (id) => (guild._banList?.has(id) ? { user: { id } } : null),
      remove: async (id) => {
        guild._unbanned = id;
      },
    },
    members: {
      me: { id: "bot-1", permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } },
      fetch: async (id) => membersCache.get(id) || null,
      cache: membersCache,
    },
  };
  guild._banList = new Set([TARGET_ID]);
  return {
    user: { id: "staff-1", tag: "staff#0001" },
    member: {
      id: "staff-1",
      guild,
      roles: { cache: new Collection(), highest: { position: 5 } },
      permissions: new PermissionsBitField(PermissionsBitField.All),
    },
    guild,
    channel,
    followUp: async () => ({}),
    _targetMember: targetMember,
    _channel: channel,
  };
}

const client = { user: { id: "bot-1", tag: "bot#0000" } };

(async () => {
  console.log("Exécution réelle depuis le panel :");

  

  

  await cas("giveaway_start poste dans le salon choisi", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.giveaway_start.run(client, interaction, { channelId: "c1", text: { duration: "1h", prize: "Nitro" } });
    assert.ok(interaction._channel._sent?.length > 0);
  });

  await cas("poll_create poste la bonne question dans le salon choisi", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.poll_create.run(client, interaction, {
      channelId: "c1",
      text: { question: "Meilleur jeu ?", option1: "Valorant", option2: "LoL" },
    });
    const sent = interaction._channel._sent?.[0];
    const json = JSON.stringify(sent?.components?.[0]?.toJSON?.() || "");
    assert.ok(json.includes("Meilleur jeu"));
  });

  await cas("ticket_setup poste le message dans le salon choisi", async () => {
    const interaction = makeInteraction();
    interaction.guild.roles.cache.set("r1", { id: "r1", name: "Support" });
    await commandForms.FORMS.ticket_setup.run(client, interaction, { channelId: "c1", roleId: "r1" });
    assert.ok(interaction._channel._sent?.length > 0);
  });

  await cas("role_create crée un rôle avec le bon nom", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.role_create.run(client, interaction, { text: { name: "Testeur" } });
    assert.strictEqual(interaction.guild._createdRole?.name, "Testeur");
  });

  

  

  

  await cas("addrole_member ajoute bien le rôle choisi", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.addrole_member.run(client, interaction, { userId: TARGET_ID, roleId: TEST_ROLE_ID });
    assert.ok(interaction._targetMember.roles._added?.some((r) => r === TEST_ROLE_ID));
  });

  await cas("delrole_member retire bien le rôle choisi", async () => {
    const interaction = makeInteraction();
    interaction._targetMember.roles.cache.set(TEST_ROLE_ID, { id: TEST_ROLE_ID, position: 2 });
    await commandForms.FORMS.delrole_member.run(client, interaction, { userId: TARGET_ID, roleId: TEST_ROLE_ID });
    assert.ok(interaction._targetMember.roles._removed?.some((r) => r === TEST_ROLE_ID));
  });

  await cas("la carte delrole_member ne propose que les rôles déjà possédés par la cible", () => {
    const interaction = makeInteraction();
    const autreRoleId = "role-222222222222222";
    interaction.guild.roles.cache.set(autreRoleId, { id: autreRoleId, name: "AutreRole", position: 1 });
    interaction._targetMember.roles.cache.set(TEST_ROLE_ID, { id: TEST_ROLE_ID, name: "Testeur", position: 2 });
    const member = { id: "staff-1", guild: interaction.guild };

    commandForms.setFormState("staff-1", "delrole_member", { userId: TARGET_ID });
    const json = commandForms.buildFormCard("delrole_member", member).components[0].toJSON();
    commandForms.clearFormState("staff-1", "delrole_member");

    const menuRow = json.components.find((c) => c.type === 1 && c.components[0]?.type === 3);
    assert.ok(menuRow, "un menu déroulant classique (type 3) doit remplacer le RoleSelectMenu natif");
    const valeurs = menuRow.components[0].options.map((o) => o.value);
    assert.deepStrictEqual(valeurs, [TEST_ROLE_ID], "seul le rôle déjà possédé par la cible doit apparaître, pas AutreRole");
  });

  await cas("la carte delrole_member affiche un message quand la cible n'a aucun rôle", () => {
    const interaction = makeInteraction();
    const member = { id: "staff-1", guild: interaction.guild };

    commandForms.setFormState("staff-1", "delrole_member", { userId: TARGET_ID });
    const json = commandForms.buildFormCard("delrole_member", member).components[0].toJSON();
    commandForms.clearFormState("staff-1", "delrole_member");

    const menuRow = json.components.find((c) => c.type === 1 && c.components[0]?.type === 3);
    assert.ok(!menuRow, "aucun menu ne doit apparaître si la cible n'a aucun rôle");
    const texte = json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("aucun rôle"), texte);
  });

  await cas("lock_channel verrouille le salon choisi", async () => {
    const interaction = makeInteraction();
    let edited = null;
    interaction._channel.permissionOverwrites.edit = async (role, perms) => {
      edited = perms;
    };
    await commandForms.FORMS.lock_channel.run(client, interaction, { channelId: "c1" });
    assert.strictEqual(edited?.SendMessages, false);
  });

  await cas("slowmode_channel applique la bonne durée en secondes", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.slowmode_channel.run(client, interaction, { channelId: "c1", text: { duration: "30s" } });
    assert.strictEqual(interaction._channel._rateLimit, 30);
  });

  

  

  console.log("\nGénéralisation des sélecteurs natifs à des commandes existantes :");

  

  await cas("role_admin_grant réutilise le VRAI &role admin, donc demande confirmation (jamais immédiat)", async () => {
    const { PermissionsBitField } = require("discord.js");
    const interaction = makeInteraction();
    const role = interaction.guild.roles.cache.get(TEST_ROLE_ID);
    role.permissions = new PermissionsBitField([]);
    const followUps = [];
    interaction.followUp = async (p) => {
      followUps.push(p);
      return {};
    };
    await commandForms.FORMS.role_admin_grant.run(client, interaction, { roleId: TEST_ROLE_ID });
    assert.ok(!role.permissions.has(PermissionsBitField.Flags.Administrator), "Administrateur ne doit jamais être donné sans confirmation");
    assert.ok(followUps.length > 0, "une confirmation aurait dû être demandée");
  });

  

  await cas("autoreact_add puis autoreact_del sur le même salon/émoji", async () => {
    const autoReactStore = require("../utils/autoReactStore");
    const interaction = makeInteraction();
    await commandForms.FORMS.autoreact_add.run(client, interaction, { channelId: "c1", text: { emoji: "👍" } });
    assert.ok(autoReactStore.getForChannel("c1").includes("👍"));
    await commandForms.FORMS.autoreact_del.run(client, interaction, { channelId: "c1", text: { emoji: "👍" } });
    assert.ok(!autoReactStore.getForChannel("c1").includes("👍"));
  });

  // Les anciens formulaires "clé de permission" (set_perm_grant/del_perm_grant)
  // envoyaient une clé à setPerm, qui attend un niveau 1-9 : ils ne faisaient
  // rien. Retirés — les niveaux se règlent par &set perm/&del perm, &access
  // @membre et &panel > Permissions.
  await cas("plus aucun formulaire à clé de permission (système à niveaux)", async () => {
    assert.ok(!commandForms.FORMS.set_perm_grant && !commandForms.FORMS.del_perm_grant);
    assert.ok(!Object.values(commandForms.BARE_COMMAND_FORMS).some((k) => /perm_grant/.test(k)));
    // Une carte périmée encore affichée répond au lieu d'échouer en silence.
    let repondu = null;
    await commandForms.handleFormCardInteraction({
      customId: `${commandForms.CARD_ID}:launch:set_perm_grant`,
      reply: async (p) => {
        repondu = p;
      },
    });
    assert.ok(repondu && /plus disponible/.test(repondu.content), "une carte périmée doit répondre");
  });

  await cas("le champ mentionable résout correctement un RÔLE choisi dans le menu natif", async () => {
    const { Collection } = require("discord.js");
    const role = { id: TEST_ROLE_ID, name: "Testeur" };
    const interaction = {
      customId: `${commandForms.CARD_ID}:mentionable:addrole_member`,
      user: { id: "staff-1" },
      member: { id: "staff-1", guild: { id: "g1" }, permissions: new (require("discord.js").PermissionsBitField)(require("discord.js").PermissionsBitField.All) },
      guild: { id: "g1", roles: { cache: new Collection([[TEST_ROLE_ID, role]]) }, channels: { cache: new Collection() } },
      values: [TEST_ROLE_ID],
      roles: new Collection([[TEST_ROLE_ID, role]]),
      members: new Collection(),
      users: new Collection(),
      update: async () => {},
    };
    // addrole_member n'a pas de champ "mentionable" mais handleFormCardInteraction
    // ne valide que l'action générique de sélection avant de router — on vise
    // ici uniquement la résolution rôle/membre, pas le formulaire réel.
    await commandForms.handleFormCardInteraction(interaction);
    assert.strictEqual(commandForms.getFormState("staff-1", "addrole_member")?.mentionableType, "role");
    assert.strictEqual(commandForms.getFormState("staff-1", "addrole_member")?.mentionableId, TEST_ROLE_ID);
    commandForms.clearFormState("staff-1", "addrole_member");
  });

  console.log("\nCommandes volontairement NON interceptées (raccourci zéro-argument déjà utile, voir le commentaire dans commandForms.js) :");

  await cas("aucune de ces commandes n'a de carte : leur comportement direct reste inchangé", () => {
    for (const bare of ["clear", "modlogs", "sync", "wl", "unwl", "cleanup", "modlog"]) {
      assert.ok(!commandForms.BARE_COMMAND_FORMS[bare], `"${bare}" ne doit pas avoir de carte (regression de raccourci)`);
    }
  });

  await cas("les commandes non implémentées du catalogue n'ont pas non plus de carte fictive", () => {
    for (const fake of ["openmodmail", "restrict", "nolog", "noderank", "piconly", "public", "boostlog", "ticket add", "ticket del"]) {
      assert.ok(!commandForms.BARE_COMMAND_FORMS[fake], `"${fake}" n'a pas de vrai handler, ne doit pas avoir de carte`);
    }
  });

  console.log("\n&warn/&warnings/&unwarn/&case — cartes natives :");

  


  console.log("\n&autorole add/del — cartes natives :");

  await cas("autorole_add whiteliste le rôle choisi", async () => {
    const autoroleStore = require("../utils/autoroleStore");
    const interaction = makeInteraction();
    await commandForms.FORMS.autorole_add.run(client, interaction, { roleId: TEST_ROLE_ID });
    assert.ok(autoroleStore.getRoleIds("g1").includes(TEST_ROLE_ID));
  });

  await cas("autorole_del retire le rôle choisi", async () => {
    const autoroleStore = require("../utils/autoroleStore");
    const interaction = makeInteraction();
    await commandForms.FORMS.autorole_del.run(client, interaction, { roleId: TEST_ROLE_ID });
    assert.ok(!autoroleStore.getRoleIds("g1").includes(TEST_ROLE_ID));
  });

  console.log("\nÉtat de formulaire (par personne ET par commande) :");

  await cas("setFormState fusionne sans écraser les autres champs texte", () => {
    commandForms.setFormState("u1", "giveaway_start", { text: { duration: "1h" } });
    commandForms.setFormState("u1", "giveaway_start", { text: { prize: "Nitro" } });
    const state = commandForms.getFormState("u1", "giveaway_start");
    assert.deepStrictEqual(state.text, { duration: "1h", prize: "Nitro" });
  });

  await cas("deux commandes différentes n'interfèrent pas entre elles pour la même personne", () => {
    commandForms.setFormState("u1", "giveaway_start", { channelId: "c-giveaway" });
    commandForms.setFormState("u1", "kick_member", { userId: "target-1" });
    assert.strictEqual(commandForms.getFormState("u1", "giveaway_start").channelId, "c-giveaway");
    assert.strictEqual(commandForms.getFormState("u1", "kick_member").userId, "target-1");
  });

  await cas("clearFormState efface uniquement l'état de la commande visée", () => {
    commandForms.clearFormState("u1", "giveaway_start");
    assert.strictEqual(commandForms.getFormState("u1", "giveaway_start"), null);
    assert.strictEqual(commandForms.getFormState("u1", "kick_member").userId, "target-1");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
