import test from 'node:test';
import assert from 'node:assert/strict';
import { navigate } from '../src/navigation.js';
test('stuck navigation is cancelled and settles before another action can start', async () => {
  let rejectPath, cleared = false, settled = false;
  const bot = {
    pathfinder: {
      goto: () => new Promise((_, reject) => { rejectPath = reject; }),
      setGoal: goal => {
        assert.equal(goal, null);
        setTimeout(() => { settled = true; rejectPath(new Error('Goal changed')); }, 5);
      }
    },
    clearControlStates: () => { cleared = true; }
  };
  await assert.rejects(navigate(bot, {}, 5), /Navigation timed out after 5 ms/);
  assert.equal(cleared, true);
  assert.equal(settled, true);
});
