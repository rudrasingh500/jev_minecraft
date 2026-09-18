import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { woodSupply, resourceTargets, goalRecipeGuidance } from '../src/resources.js';
import { advancePlan } from '../src/planning.js';

test('observed wood surplus counts logs as four planks',()=>{
 assert.equal(woodSupply({spruce_log:13,oak_log:1,spruce_planks:7,stick:2}),63);
 assert.equal(woodSupply({crimson_stem:4}),16);
});
test('buried matches do not hide later visible stone; exposed resources get approach options',()=>{
 const positions=Array.from({length:12},(_,i)=>new Vec3(i+1,64,0));
 const bot={entity:{position:new Vec3(0,64,0)},inventory:{items:()=>[]},findBlocks:()=>positions,
  blockAt:p=>p.z===0?{name:'stone',position:p,boundingBox:'block'}:p.x===11&&p.z===1?{name:p.y<64?'stone':'air',boundingBox:p.y<64?'block':'empty'}:{name:'stone',boundingBox:'block'},
  canSeeBlock:b=>b.position.x===12};
 const targets=resourceTargets(bot,/stone/);
 assert.equal(targets[0].block.position.x,12);assert.equal(targets[0].visible,true);
 assert.equal(targets[1].block.position.x,11);assert.equal(targets[1].visible,false);
 assert.equal(targets.length,2);
});
test('stone pickaxe guidance identifies cobblestone rather than more wood with sticks ready',()=>{
 const bot={registry:{itemsByName:{stone_pickaxe:{id:1}},items:{2:{name:'cobblestone'},3:{name:'stick'}}},recipesAll:()=>[{requiresTable:true,result:{count:1},delta:[{id:1,count:1},{id:2,count:-3},{id:3,count:-2}]}]};
 const guidance=goalRecipeGuidance(bot,{inventory:{stick:2,spruce_log:14},memory:{plan:{completion:[{kind:'inventory',key:'stone_pickaxe',target:1}]}}});
 assert.deepEqual(guidance[0].recipe.missing,[{name:'cobblestone',required:3,held:0}]);
});
test('wandering cannot reset the microgoal stall clock',()=>{
 const memory={plan:{completion:[{}],selectedBy:'gpt-5.6-luna',actionsTaken:0,failures:0,noProgress:0,lastProgressAt:1}};
 advancePlan(memory,{result:'completed',from:{x:0,y:60,z:0},to:{x:20,y:60,z:0},inventoryDelta:{},healthDelta:0});
 assert.equal(memory.plan.lastProgressAt,1);assert.equal(memory.plan.noProgress,1);
});
