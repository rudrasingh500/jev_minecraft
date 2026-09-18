import test from 'node:test';
import assert from 'node:assert/strict';
import { objective, desiredCrafts, count } from '../src/strategy.js';
import { config } from '../src/config.js';
const state = (inventory = {}, dimension = 'overworld') => ({ inventory, dimension, equipped: [], tableNearby: false, furnaceNearby: false });
test('the sole objective stays fixed across dimensions, equipment upgrades and item loss', () => {
  for (const dimension of ['overworld', 'the_nether', 'the_end']) {
    for (const inventory of [{}, {wooden_pickaxe:1}, {iron_pickaxe:1}, {stone_pickaxe:1}, {ender_eye:12}]) {
      assert.equal(objective(state(inventory, dimension)), 'Beat the Ender Dragon');
    }
  }
});
test('craft priorities avoid replacing an advanced pickaxe with wood', () => {
  const crafts = desiredCrafts(state({ iron_pickaxe: 1, oak_log: 2 }));
  assert.ok(crafts.includes('oak_planks'));
  assert.ok(crafts.includes('diamond_pickaxe'));
  assert.ok(!crafts.includes('wooden_pickaxe'));
  assert.ok(!crafts.includes('stone_pickaxe'));
  assert.equal(count({ oak_log: 3, birch_log: 4, stone: 9 }, /_log$/), 7);
});
test('configuration rejects invalid limits and unsupported authentication', () => {
  assert.throws(() => config({ MC_PORT: '-1' }), /MC_PORT/);
  assert.throws(() => config({ MC_AUTH: 'invalid' }), /MC_AUTH/);
  assert.throws(() => config({ MIN_CONFIDENCE: '2' }), /MIN_CONFIDENCE/);
  assert.equal(config({ MC_PORT: '51234' }).port, 51234);
});
