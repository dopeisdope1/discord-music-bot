function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function listField(items, { empty = "Aucun.", limit = 25 } = {}) {
  if (!items.length) return empty;
  const shown = items.slice(0, limit);
  const extra = items.length - shown.length;
  return shown.join("\n") + (extra > 0 ? `\n… et ${extra} de plus.` : "");
}

module.exports = { chunk, listField };
