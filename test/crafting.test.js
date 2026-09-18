import test from 'node:test';
import assert from 'node:assert/strict';
import { Actions } from '../src/actions.js';
test('inventory recipes craft in place without walking to a table', async () => {
  const recipe = { requiresTable: false };
  let crafted = false;
  const bot = {
    registry: {itemsByName:{acacia_planks:{id:1}}},
    recipesFor: (_, __, ___, table) => { assert.equal(table,null); return [recipe]; },
    craft: async (r,n,table) => { assert.equal(r,recipe); assert.equal(table,null); crafted=true; },
    findBlock: () => assert.fail('Inventory crafting must not search for a table')
  };
  await new Actions(bot,{}).craft('acacia_planks');
  assert.ok(crafted);
});
