import test from 'node:test';
import assert from 'node:assert/strict';
import { executionContext } from '../src/context.js';
import { JevClient } from '../src/jev.js';
import { LunaPlanner } from '../src/luna.js';
const state={objective:'Beat the Ender Dragon',inventory:{wooden_pickaxe:1,spruce_log:14,stick:2},health:8,entities:[{name:'zombie',distance:3}],
 goalRecipeGuidance:[{target:'stone_pickaxe',recipe:{requiresTable:true,missing:[{name:'cobblestone',required:3,held:0}]}}],
 memory:{plan:{id:'current',description:'Craft a stone pickaxe',steps:['Mine stone','Craft upgrade'],completion:[{kind:'inventory',key:'stone_pickaxe',target:1}],selectedAt:1,startInventory:{},actionsTaken:20},
 planHistory:[{description:'OLD_WOOD_GOAL'}],lessons:[{tactic:'OLD_WOOD_LESSON'}],milestones:['OLD_TABLE'],recentPath:[{x:99}],
 recentActions:Array.from({length:10},(_,i)=>({action:`explore_${i}`,result:'completed',inventoryDelta:{}})),
 knownPlaces:[{name:'crafting_table'},{name:'chest'}],failures:[{action:'mine_stone',reason:'unreachable'},{action:'old_action'}]}};
const candidates=[{id:'mine_stone',description:'Mine stone'},{id:'flee',description:'Flee zombie'}];

test('Jev wire context centers the microgoal while preserving safety and available actions',async()=>{
 const before=structuredClone(state);
 const client=new JevClient({key:'test',fetchImpl:async(url,opts)=>{
  const body=JSON.parse(opts.body);
  assert.equal(body.state.memory,undefined);
  assert.equal(body.state.microgoal.description,'Craft a stone pickaxe');
  assert.deepEqual(body.state.inventory,state.inventory);
  assert.deepEqual(body.state.entities,state.entities);
  assert.equal(body.state.health,8);
  assert.equal(body.state.tacticalMemory.recentActions.length,4);
  assert.equal(body.state.tacticalMemory.recentActions[0].action,'explore_6');
  assert.deepEqual(body.state.tacticalMemory.failures,[state.memory.failures[0]]);
  assert.deepEqual(body.state.tacticalMemory.knownPlaces,[]);
  assert.deepEqual(Object.keys(body.questions.action.criteria),['mine_stone','flee']);
  assert.ok(!opts.body.includes('OLD_'));
  return Response.json({answers:{action:{type:'choice',choice:'flee',confidence:0.9}}});
 }});
 await client.choose(state,candidates);
 assert.deepEqual(state,before);
});
test('completed and missing microgoals do not leave active steps in execution context',()=>{
 const done=structuredClone(state);done.memory.plan.completedAt=123;
 const projected=executionContext(done,candidates);
 assert.equal(projected.microgoal.status,'completed');assert.deepEqual(projected.microgoal.steps,[]);
 assert.deepEqual(projected.goalRecipeGuidance,[]);
 assert.equal(executionContext({inventory:{}},candidates).microgoal,null);
});
test('Luna continues receiving strategic history that is removed from Jev',async()=>{
 const planner=new LunaPlanner({key:'test',fetchImpl:async(url,opts)=>{
  const input=JSON.parse(JSON.parse(opts.body).input);
  assert.equal(input.state.memory.planHistory[0].description,'OLD_WOOD_GOAL');
  assert.equal(input.state.memory.lessons[0].tactic,'OLD_WOOD_LESSON');
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]});
 }});
 await planner.propose(state,candidates,'review');
});
