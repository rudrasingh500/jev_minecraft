import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { goalRecipeGuidance } from '../src/resources.js';
import { advancePlan } from '../src/planning.js';

test('stone pickaxe guidance identifies cobblestone rather than more wood with sticks ready',()=>{
 const bot={registry:{itemsByName:{stone_pickaxe:{id:1}},items:{2:{name:'cobblestone'},3:{name:'stick'}}},recipesAll:()=>[{requiresTable:true,result:{count:1},delta:[{id:1,count:1},{id:2,count:-3},{id:3,count:-2}]}]};
 const guidance=goalRecipeGuidance(bot,{inventory:{stick:2,spruce_log:14},memory:{plan:{completion:[{kind:'inventory',key:'stone_pickaxe',target:1}]}}});
 assert.deepEqual(guidance[0].recipe.missing,[{name:'cobblestone',required:3,held:0}]);
});
test('wandering cannot reset the microgoal stall clock',()=>{
 const memory={plan:{completion:[{}],selectedBy:'advisor',actionsTaken:0,failures:0,noProgress:0,lastProgressAt:1}};
 advancePlan(memory,{result:'completed',from:{x:0,y:60,z:0},to:{x:20,y:60,z:0},inventoryDelta:{},healthDelta:0});
 assert.equal(memory.plan.lastProgressAt,1);assert.equal(memory.plan.noProgress,1);
});
