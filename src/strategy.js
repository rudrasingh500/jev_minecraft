export function count(items, matcher) {
  return Object.entries(items).reduce((sum, [name, n]) => sum + (typeof matcher === 'string' ? name === matcher : matcher.test(name) ? true : false) * n, 0);
}

export const RUN_OBJECTIVE = 'Beat the Ender Dragon';

export function objective() {
  return RUN_OBJECTIVE;
}

export function desiredCrafts(s) {
  const inv = s.inventory;
  const n = name => inv[name] || 0;
  const list = [];
  const want = (name, target) => { if (n(name) < target) list.push(name); };
  if (count(inv, /_planks$/) < 16) for (const name of Object.keys(inv)) {
    if (/_log$/.test(name)) list.push(name.replace('_log', '_planks'));
    if (/_stem$/.test(name)) list.push(name.replace('_stem', '_planks'));
  }
  want('crafting_table', s.tableNearby ? 0 : 1);
  want('stick', 8);
  if (!count(inv, /pickaxe$/)) want('wooden_pickaxe', 1);
  if (!count(inv, /stone_pickaxe|iron_pickaxe|diamond_pickaxe/)) want('stone_pickaxe', 1);
  want('furnace', s.furnaceNearby ? 0 : 1);
  if (!n('diamond_pickaxe')) want('iron_pickaxe', 1);
  want('diamond_pickaxe', 1);
  if (!count(inv, /iron_sword|diamond_sword/)) want('stone_sword', 1);
  want('iron_sword', 1);
  want('flint_and_steel', 1);
  for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) if (!s.equipped.includes(`iron_${piece}`)) want(`iron_${piece}`, 1);
  want('bow', 1); want('arrow', 48); want('bread', 12);
  if (n('blaze_rod') > 0 && n('blaze_powder') + n('ender_eye') < 14) list.push('blaze_powder');
  want('ender_eye', 14);
  return [...new Set(list)];
}
