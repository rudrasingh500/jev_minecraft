import test from 'node:test';
import assert from 'node:assert/strict';
import { explorationOptions, loopSummary } from '../src/exploration.js';
import { navigate } from '../src/navigation.js';
import { Vec3 } from 'vec3';
const state={dimension:'overworld',position:{x:-83.5,y:96,z:-40.5}};
const entry=(from,to)=>({dimension:'overworld',action:'explore_west',from,to,inventoryDelta:{}});
test('actual log positions suppress immediate east reversal despite stopping short of requested goal',()=>{
 const memory={recent:[entry({x:-74.6,y:95,z:-40.5},state.position)]};
 const options=explorationOptions(memory,state);
 assert.ok(!options.some(o=>o.label==='east'));
 assert.ok(options.some(o=>o.label==='west'));
});
test('revisited routes retain an escape option and dimension histories do not leak',()=>{
 const recent=[[-84,-53],[-72,-41],[-84,-29],[-96,-41]].map(([x,z])=>entry({x,y:96,z},state.position));
 assert.ok(explorationOptions({recent},state).length>0);
 assert.equal(explorationOptions({recent}, {...state,dimension:'the_nether'}).length,4);
});
test('loop summary detects the observed back-and-forth cycle',()=>{
 const a={x:0,z:0},b={x:9,z:0};
 const summary=loopSummary({recent:[entry(a,b),entry(b,a),entry(a,b),entry(b,a)]},'overworld');
 assert.equal(summary.explorationActions,4);assert.ok(summary.returnsToRecentPositions>=2);assert.ok(summary.warning);
});
test('resolved pathfinder promise cannot report a goal reached at the wrong position',async()=>{
 const bot={entity:{position:new Vec3(0,64,0)},pathfinder:{goto:async()=>{}},clearControlStates:()=>{}};
 await assert.rejects(navigate(bot,{isEnd:p=>p.x===10}),/before reaching/);
 await navigate(bot,{isEnd:p=>p.x===0});
});
