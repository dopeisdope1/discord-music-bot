const { LEVEL } = require("../../utils/permLevels");
const permissionEngine = require("../../utils/permissionEngine");
const permissionsStore = require("../../utils/permissionsStore");
const voiceMasterStore = require("../../utils/voiceMasterStore");
const { buildCard, buildTreeList, appendText, payload } = require("../../utils/panelComponents");

module.exports = {
  name: "helpall",
  category: "info",
  description: "Affiche les commandes accessibles par l'auteur, cumulées jusqu'à son rang",
  usage: "&helpall",
  level: LEVEL.CONFIGURABLE_NO_COOLDOWN,
  async execute(ctx) {
    // sys/super_sys court-circuitent le moteur de permissions, donc pas de
    // découpage par slot pertinent pour eux — on retombe sur tous les slots du serveur.
    const slots = ctx.isSysOrAbove
      ? permissionsStore.listByGuild(ctx.guildId)
      : permissionEngine.resolveSlotsForMember(ctx.guildId, ctx.member).slots;

    const entries = slots
      .filter((slot) => slot.commands.length)
      .map((slot) => [slot.name, slot.commands.join(", ")]);

    // Voice Master n'est pas un slot de permission : c'est une voie d'accès
    // parallèle (&panel > Voice Master), donc listée à part sinon elle
    // n'apparaîtrait nulle part.
    const vm = voiceMasterStore.getConfig(ctx.guildId);
    const hasVoiceMaster = ctx.isSysOrAbove || voiceMasterStore.isVoiceMaster(ctx.guildId, ctx.member);
    if (hasVoiceMaster && vm.roles.length && vm.actions.length) {
      const labels = voiceMasterStore.ACTIONS.filter((a) => vm.actions.includes(a.key)).map((a) => a.label);
      entries.push(["Voice Master", `voc — ${labels.join(", ")}`]);
    }

    const container = buildCard({
      title: "Permissions liées aux commandes",
      description: "Voici les différentes permissions ainsi que les commandes accessibles",
    });
    appendText(container, buildTreeList(entries, { empty: "Aucune commande accessible." }));

    await ctx.reply(payload(container));
  },
};
