const { LEVEL } = require("../../utils/permLevels");
const permissionsStore = require("../../utils/permissionsStore");
const { buildCard, buildTreeList, appendText, payload } = require("../../utils/panelComponents");

function entryFor(slot) {
  const combined = [...slot.roles.map((r) => `<@&${r}>`), ...slot.members.map((m) => `<@${m}>`)];
  return [slot.name, combined.length ? combined.join(", ") : "aucun"];
}

module.exports = {
  name: "perms",
  category: "info",
  description: "Affiche les rôles et membres liés à chaque permission",
  usage: "&perms",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const slots = permissionsStore.listByGuild(ctx.guildId);
    const hierarchical = slots.filter((s) => !s.exclusive);
    const exclusive = slots.filter((s) => s.exclusive);

    const container = buildCard({
      title: "Permissions",
      description: "Voici les différentes permissions ainsi que les rôles et membres associés",
    });

    let body = buildTreeList(hierarchical.map(entryFor), { empty: "Aucune permission configurée." });
    if (exclusive.length) body += `\n\n— Exclusives —\n\n${buildTreeList(exclusive.map(entryFor))}`;
    appendText(container, body);

    await ctx.reply(payload(container));
  },
};
