import test from 'node:test';
import assert from 'node:assert/strict';
import { planOptions, needsPlan, selectPlan, advancePlan } from '../src/planning.js';
import { compactRequest } from '../src/context.js';
const actions = [
  { id: 'mine_1_2_3', description: 'Mine iron_ore at (1,2,3)' },
  { id: 'mine_2_2_3', description: 'Mine iron_ore at (2,2,3)' },
  { id: 'craft_stick', description: 'Craft stick' }
];
test('plans group equivalent capabilities without enforcing progression', () => {
  assert.deepEqual(planOptions(actions).map(p => p.id), ['gather:iron_ore', 'craft_stick']);
  const memory = {};
  const state = { dimension: 'overworld', objective: 'Beat the Ender Dragon' };
  selectPlan(memory, planOptions(actions)[1], state, 0.8);
  assert.equal(needsPlan(memory,state,actions),false);
  assert.equal(state.objective,'Beat the Ender Dragon');
  assert.equal(needsPlan(memory,{...state,dimension:'the_nether'},actions),true);
  assert.equal(needsPlan(memory,state,actions.slice(0,1)),true);
  for (let i=0;i<2;i++) advancePlan(memory,{result:'failed',from:{x:0,y:0,z:0},to:{x:0,y:0,z:0},inventoryDelta:{},healthDelta:0});
  assert.equal(needsPlan(memory,state,actions),true);
});
test('local compaction removes duplicated history and preserves objective, plan, inventory and choices', () => {
  const request = { model:'jev-latest', state:{objective:'Beat the Ender Dragon',inventory:{iron_pickaxe:1},
    recentActions:[{action:'duplicate'}],memory:{plan:{id:'gather:iron_ore'},recentActions:Array.from({length:20},(_,i)=>({action:`mine_${i}`,error:'x'.repeat(1000)}))}},
    questions:{action:{type:'choice',criteria:{mine:'Mine iron',explore:'Explore'}}} };
  const result = compactRequest(request,2500);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<=2500);
  assert.equal(result.state.recentActions,undefined);
  assert.equal(result.state.memory.recentActions.at(-1).action,'mine_19');
  assert.deepEqual(result.questions,request.questions);
  assert.deepEqual(result.state.inventory,request.state.inventory);
  assert.deepEqual(result.state.memory.plan,request.state.memory.plan);
  assert.equal(request.state.memory.recentActions.length,20);
  assert.ok(!JSON.stringify(result).includes('tokenBudget'));
});
test('oversized essential input is rejected rather than silently dropping actions', () => {
  assert.throws(()=>compactRequest({state:{inventory:{a:'x'.repeat(1000)}},questions:{}},100),/essential observations/);
});
