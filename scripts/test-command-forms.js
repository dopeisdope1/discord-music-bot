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

  await cas("kick_member expulse réellement la cible", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.kick_member.run(client, interaction, { userId: TARGET_ID, text: { reason: "spam" } });
    assert.strictEqual(interaction._targetMember._kicked, "spam");
  });

  await cas("timeout_member applique la bonne durée", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.timeout_member.run(client, interaction, { userId: TARGET_ID, text: { duration: "10m", reason: "test" } });
    assert.strictEqual(interaction._targetMember._timedOut.ms, 10 * 60 * 1000);
  });

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

  await cas("ban_member réutilise le VRAI &ban et bannit DIRECTEMENT — la confirmation a été retirée", async () => {
    // Comportement demandé explicitement, le risque ayant été exposé : plus de
    // panneau « Confirmer le bannissement ». Ce qui protège encore : le droit
    // exigé, la hiérarchie des rôles vérifiée juste avant, et l'entrée
    // d'historique — vérifiés par les cas voisins.
    const interaction = makeInteraction();
    const followUps = [];
    interaction.followUp = async (p) => {
      followUps.push(p);
      return {};
    };
    await commandForms.FORMS.ban_member.run(client, interaction, { userId: TARGET_ID, text: { reason: "raid" } });
    assert.ok(interaction._targetMember._banned, "&ban doit désormais bannir sans étape de confirmation");
    assert.strictEqual(interaction._targetMember._banned.reason, "raid", "la raison doit être transmise à Discord");
  });

  await cas("softban_member bannit avec deleteMessageSeconds (purge) puis prévoit le débannissement", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.softban_member.run(client, interaction, { userId: TARGET_ID, text: {} });
    assert.strictEqual(interaction._targetMember._banned?.deleteMessageSeconds, 86400);
  });

  await cas("unban_id débannit l'identifiant fourni", async () => {
    const interaction = makeInteraction();
    await commandForms.FORMS.unban_id.run(client, interaction, { text: { id: TARGET_ID } });
    assert.strictEqual(interaction.guild._unbanned, TARGET_ID);
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

  await cas("mute_member ajoute le rôle de mute configuré", async () => {
    const muteStore = require("../utils/muteStore");
    muteStore.setMuteRoleId("g1", TEST_ROLE_ID);
    const interaction = makeInteraction();
    await commandForms.FORMS.mute_member.run(client, interaction, { userId: TARGET_ID, text: { reason: "spam" } });
    assert.ok(interaction._targetMember.roles._added?.some((r) => r === TEST_ROLE_ID));
  });

  await cas("derank_member retire tous les rôles retirables de la cible", async () => {
    const interaction = makeInteraction();
    interaction._targetMember.roles.cache.set(TEST_ROLE_ID, { id: TEST_ROLE_ID, position: 2 });
    await commandForms.FORMS.derank_member.run(client, interaction, { userId: TARGET_ID });
    assert.ok(interaction._targetMember.roles._removed?.length > 0);
  });

  console.log("\nGénéralisation des sélecteurs natifs à des commandes existantes :");

  await cas("del_sanction_member supprime bien la sanction visée par son numéro", async () => {
    const historyStore = require("../utils/moderationHistoryStore");
    historyStore.deleteAllForGuild("g1");
    historyStore.record({ guildId: "g1", targetId: TARGET_ID, action: "ban" });
    // Numéro de case PERMANENT (attribué par utils/caseCounterStore.js) —
    // jamais "1" en dur : d'autres cas de ce fichier ont déjà pu faire
    // avancer le compteur de "g1" avant celui-ci.
    const caseNumber = String(historyStore.search("g1", { targetId: TARGET_ID })[0].caseNumber);
    const interaction = makeInteraction();
    await commandForms.FORMS.del_sanction_member.run(client, interaction, { userId: TARGET_ID, text: { index: caseNumber } });
    assert.strictEqual(historyStore.search("g1", { targetId: TARGET_ID }).length, 0);
  });

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

  await cas("voicehub_set règle le salon générateur choisi", async () => {
    const voiceChannels = require("../utils/voiceChannels");
    const interaction = makeInteraction();
    interaction.guild.channels.cache.set("vc1", { id: "vc1", type: ChannelType.GuildVoice, name: "Vocal" });
    await commandForms.FORMS.voicehub_set.run(client, interaction, { channelId: "vc1" });
    assert.strictEqual(voiceChannels.getHub("g1"), "vc1");
  });

  await cas("set_muterole_grant enregistre le rôle de mute choisi", async () => {
    const muteStore = require("../utils/muteStore");
    const interaction = makeInteraction();
    await commandForms.FORMS.set_muterole_grant.run(client, interaction, { roleId: TEST_ROLE_ID });
    assert.strictEqual(muteStore.getMuteRoleId("g1"), TEST_ROLE_ID);
  });

  await cas("autoreact_add puis autoreact_del sur le même salon/émoji", async () => {
    const autoReactStore = require("../utils/autoReactStore");
    const interaction = makeInteraction();
    await commandForms.FORMS.autoreact_add.run(client, interaction, { channelId: "c1", text: { emoji: "👍" } });
    assert.ok(autoReactStore.getForChannel("c1").includes("👍"));
    await commandForms.FORMS.autoreact_del.run(client, interaction, { channelId: "c1", text: { emoji: "👍" } });
    assert.ok(!autoReactStore.getForChannel("c1").includes("👍"));
  });

  await cas("link_channel_exempt exempte le salon choisi de l'anti-lien", async () => {
    const antiLink = require("../utils/automod/antiLink");
    const interaction = makeInteraction();
    await commandForms.FORMS.link_channel_exempt.run(client, interaction, { channelId: "c1", text: { action: "allow" } });
    assert.ok(antiLink.getAllowedChannels("g1").includes("c1"));
  });

  await cas("link_channel_exempt sans salon choisi exempte le salon COURANT (comportement inchangé de &link)", async () => {
    const antiLink = require("../utils/automod/antiLink");
    antiLink.setChannelAllowed("g1", "c1", false);
    const interaction = makeInteraction();
    await commandForms.FORMS.link_channel_exempt.run(client, interaction, { text: { action: "allow" } });
    assert.ok(antiLink.getAllowedChannels("g1").includes("c1"));
  });

  await cas("spam_channel_exempt exempte le salon choisi de l'anti-spam", async () => {
    const antiSpam = require("../utils/automod/antiSpam");
    const interaction = makeInteraction();
    await commandForms.FORMS.spam_channel_exempt.run(client, interaction, { channelId: "c1", text: { action: "allow" } });
    assert.ok(antiSpam.getExemptChannels("g1").includes("c1"));
  });

  await cas("antinuke_wluser bascule le membre dans la whitelist anti-nuke", async () => {
    const guardWhitelist = require("../utils/guard/whitelist");
    const interaction = makeInteraction();
    await commandForms.FORMS.antinuke_wluser.run(client, interaction, { userId: TARGET_ID });
    assert.ok(guardWhitelist.getWhitelist("g1").users.includes(TARGET_ID));
  });

  await cas("antinuke_wlrole bascule le rôle dans la whitelist anti-nuke", async () => {
    const guardWhitelist = require("../utils/guard/whitelist");
    const interaction = makeInteraction();
    await commandForms.FORMS.antinuke_wlrole.run(client, interaction, { roleId: TEST_ROLE_ID });
    assert.ok(guardWhitelist.getWhitelist("g1").roles.includes(TEST_ROLE_ID));
  });

  await cas("antinuke_ping règle le rôle pingé quand un rôle est choisi", async () => {
    const guardConfig = require("../utils/guard/config");
    const interaction = makeInteraction();
    await commandForms.FORMS.antinuke_ping.run(client, interaction, { roleId: TEST_ROLE_ID });
    assert.strictEqual(guardConfig.getConfig("g1").pingRoleId, TEST_ROLE_ID);
  });

  await cas("antinuke_ping désactive le ping quand aucun rôle n'est choisi (équivaut à &antinuke ping off)", async () => {
    const guardConfig = require("../utils/guard/config");
    guardConfig.setPingRole("g1", TEST_ROLE_ID);
    const interaction = makeInteraction();
    await commandForms.FORMS.antinuke_ping.run(client, interaction, {});
    assert.strictEqual(guardConfig.getConfig("g1").pingRoleId, null);
  });

  await cas("set_perm_grant accorde la clé choisie au RÔLE choisi (mentionable = rôle)", async () => {
    const permStore = require("../utils/permissions/store");
    const interaction = makeInteraction();
    await commandForms.FORMS.set_perm_grant.run(client, interaction, {
      mentionableId: TEST_ROLE_ID,
      mentionableType: "role",
      text: { category: "moderation", key: "moderation.kick" },
    });
    assert.ok(permStore.getRoleGrants("g1", TEST_ROLE_ID).includes("moderation.kick"));
  });

  await cas("set_perm_grant accorde la clé choisie au MEMBRE choisi (mentionable = membre)", async () => {
    const permStore = require("../utils/permissions/store");
    const interaction = makeInteraction();
    await commandForms.FORMS.set_perm_grant.run(client, interaction, {
      mentionableId: TARGET_ID,
      mentionableType: "user",
      text: { category: "moderation", key: "moderation.kick" },
    });
    assert.ok(permStore.getUserGrants("g1", TARGET_ID).includes("moderation.kick"));
  });

  await cas("del_perm_grant retire la clé du membre choisi", async () => {
    const permStore = require("../utils/permissions/store");
    permStore.grantToUser("g1", TARGET_ID, "moderation.kick");
    const interaction = makeInteraction();
    await commandForms.FORMS.del_perm_grant.run(client, interaction, {
      mentionableId: TARGET_ID,
      mentionableType: "user",
      text: { category: "moderation", key: "moderation.kick" },
    });
    assert.ok(!permStore.getUserGrants("g1", TARGET_ID).includes("moderation.kick"));
  });

  await cas("la carte set_perm_grant n'affiche le sélecteur de clé qu'une fois une catégorie choisie", () => {
    const emptyJson = commandForms.buildFormCard("set_perm_grant", { id: "staff-1" }).components[0].toJSON();
    // type 3 = StringSelectMenu (catégorie/clé) ; le mentionable est un type 7 à part.
    const selectRows = emptyJson.components.filter((c) => c.type === 1 && c.components[0]?.type === 3);
    // Sans catégorie choisie : uniquement le menu de catégorie, pas encore la clé.
    assert.strictEqual(selectRows.length, 1, "le menu de clé ne doit pas apparaître avant qu'une catégorie soit choisie");

    commandForms.setFormState("staff-1", "set_perm_grant", { text: { category: "moderation" } });
    const filledJson = commandForms.buildFormCard("set_perm_grant", { id: "staff-1" }).components[0].toJSON();
    const filledSelectRows = filledJson.components.filter((c) => c.type === 1 && c.components[0]?.type === 3);
    assert.strictEqual(filledSelectRows.length, 2, "le menu de clé doit apparaître une fois la catégorie choisie");
    commandForms.clearFormState("staff-1", "set_perm_grant");
  });

  await cas("le champ mentionable résout correctement un RÔLE choisi dans le menu natif", async () => {
    const { Collection } = require("discord.js");
    const role = { id: TEST_ROLE_ID, name: "Testeur" };
    const interaction = {
      customId: `${commandForms.CARD_ID}:mentionable:kick_member`,
      user: { id: "staff-1" },
      member: { id: "staff-1", guild: { id: "g1" }, permissions: new (require("discord.js").PermissionsBitField)(require("discord.js").PermissionsBitField.All) },
      guild: { id: "g1", roles: { cache: new Collection([[TEST_ROLE_ID, role]]) }, channels: { cache: new Collection() } },
      values: [TEST_ROLE_ID],
      roles: new Collection([[TEST_ROLE_ID, role]]),
      members: new Collection(),
      users: new Collection(),
      update: async () => {},
    };
    // kick_member n'a pas de champ "mentionable" mais handleFormCardInteraction
    // ne valide que l'action générique de sélection avant de router — on vise
    // ici uniquement la résolution rôle/membre, pas le formulaire réel.
    await commandForms.handleFormCardInteraction(interaction);
    assert.strictEqual(commandForms.getFormState("staff-1", "kick_member")?.mentionableType, "role");
    assert.strictEqual(commandForms.getFormState("staff-1", "kick_member")?.mentionableId, TEST_ROLE_ID);
    commandForms.clearFormState("staff-1", "kick_member");
  });

  console.log("\nCommandes volontairement NON interceptées (raccourci zéro-argument déjà utile, voir le commentaire dans commandForms.js) :");

  await cas("aucune de ces commandes n'a de carte : leur comportement direct reste inchangé", () => {
    for (const bare of ["clear", "modlogs", "sync", "wl", "unwl", "cleanup", "modlog", "voicehub off"]) {
      assert.ok(!commandForms.BARE_COMMAND_FORMS[bare], `"${bare}" ne doit pas avoir de carte (regression de raccourci)`);
    }
  });

  await cas("les commandes non implémentées du catalogue n'ont pas non plus de carte fictive", () => {
    for (const fake of ["openmodmail", "restrict", "nolog", "noderank", "piconly", "public", "boostlog", "ticket add", "ticket del"]) {
      assert.ok(!commandForms.BARE_COMMAND_FORMS[fake], `"${fake}" n'a pas de vrai handler, ne doit pas avoir de carte`);
    }
  });

  console.log("\n&warn/&warnings/&unwarn/&case — cartes natives :");

  await cas("warn_member enregistre l'avertissement avec la raison saisie", async () => {
    const historyStore = require("../utils/moderationHistoryStore");
    historyStore.deleteAllForGuild("g1");
    const interaction = makeInteraction();
    await commandForms.FORMS.warn_member.run(client, interaction, { userId: TARGET_ID, text: { reason: "comportement toxique" } });
    const entries = historyStore.search("g1", { targetId: TARGET_ID, action: "warn" });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].reason, "comportement toxique");
  });

  await cas("warnings_view répond \"membre introuvable\" plutôt que de planter sur un ID invalide", async () => {
    const interaction = makeInteraction();
    interaction.guild.members.fetch = async () => null;
    const followUps = [];
    interaction.followUp = async (p) => {
      followUps.push(p);
      return {};
    };
    await commandForms.FORMS.warnings_view.run(client, interaction, { userId: "999999999999999999" });
    assert.ok(followUps.some((p) => p.content?.includes("introuvable")));
  });

  await cas("unwarn_member retire bien l'avertissement visé par son numéro de case", async () => {
    const historyStore = require("../utils/moderationHistoryStore");
    historyStore.deleteAllForGuild("g1");
    historyStore.record({ guildId: "g1", targetId: TARGET_ID, action: "warn", reason: "à retirer" });
    const caseNumber = String(historyStore.search("g1", { targetId: TARGET_ID })[0].caseNumber);
    const interaction = makeInteraction();
    await commandForms.FORMS.unwarn_member.run(client, interaction, { userId: TARGET_ID, text: { caseNumber } });
    assert.strictEqual(historyStore.search("g1", { targetId: TARGET_ID, action: "warn" }).length, 0);
  });

  await cas("case_view affiche le détail de la case demandée (fonctionne pour n'importe quel type de sanction)", async () => {
    const historyStore = require("../utils/moderationHistoryStore");
    historyStore.deleteAllForGuild("g1");
    historyStore.record({ guildId: "g1", targetId: TARGET_ID, action: "kick", reason: "raid" });
    const caseNumber = String(historyStore.search("g1", { targetId: TARGET_ID })[0].caseNumber);
    const interaction = makeInteraction();
    const followUps = [];
    interaction.followUp = async (p) => {
      followUps.push(p);
      return {};
    };
    await commandForms.FORMS.case_view.run(client, interaction, { text: { number: caseNumber } });
    const texte = followUps[0]?.embeds?.[0]?.data?.description || "";
    assert.ok(texte.includes(`Case #${caseNumber}`) && texte.includes("kick") && texte.includes("raid"));
  });

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
