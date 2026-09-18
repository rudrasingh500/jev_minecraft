import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMemory, saveMemory, rememberBlock, recordAction, memoryContext } from '../src/memory.js';
test('memory persists, isolates worlds, and invalidates changed landmarks', () => {
  const dir = mkdtempSync(join(tmpdir(),'jev-memory-'));
  try {
    const path = join(dir,'state.json');
    const memory = loadMemory(path,'world-a');
    const position = {x:1,y:65,z:2};
    rememberBlock(memory,'overworld',{name:'crafting_table',position});
    memory.recent.push({action:'mine',objective:'Craft an iron pickaxe',inventoryDelta:{raw_iron:1}});
    saveMemory(path,memory);
    const restored = loadMemory(path,'world-a');
    assert.equal(Object.values(restored.landmarks)[0].name,'crafting_table');
    assert.equal(restored.recent[0].objective,'Beat the Ender Dragon');
    assert.deepEqual(restored.recent[0].inventoryDelta,{raw_iron:1});
    assert.deepEqual(loadMemory(path,'world-b').landmarks,{});
    rememberBlock(restored,'overworld',{name:'air',position});
    assert.deepEqual(restored.landmarks,{});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('durable lessons survive short history eviction and memory reload', () => {
  const dir = mkdtempSync(join(tmpdir(),'jev-lessons-'));
  try {
    const path=join(dir,'memory.json');
    const memory=loadMemory(path,'world');
    const state={inventory:{},health:20,position:{x:0,y:60,z:0},dimension:'overworld'};
    for(let i=0;i<45;i++) recordAction(memory,{id:`mine_${i}_60_0`,description:'Mine iron_ore'},state,state,new Error('Navigation timed out'),0.7,Date.now());
    assert.equal(memory.recent.length,40);
    saveMemory(path,memory);
    const restored=loadMemory(path,'world');
    assert.equal(Object.values(restored.lessons)[0].attempts,45);
    assert.equal(Object.values(restored.lessons)[0].errors.navigation_or_action_timeout,45);
    restored.plan={id:'craft_iron_pickaxe'};
    rememberBlock(restored,'overworld',{name:'crafting_table',position:{x:100,y:60,z:0}});
    rememberBlock(restored,'overworld',{name:'chest',position:{x:1,y:60,z:0}});
    assert.equal(memoryContext(restored,state).knownPlaces[0].name,'crafting_table');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('actions retain measured outcomes and failures back off across restarts', () => {
  const memory = {recent:[],failures:{}};
  const before = {inventory:{oak_log:2},health:20,position:{x:0,y:0,z:0},dimension:'overworld',objective:'Craft planks'};
  const after = {...before,inventory:{oak_log:1,oak_planks:4},health:18};
  const action = {id:'craft',description:'Craft planks'};
  const result = recordAction(memory,action,before,after,null,0.8,Date.now());
  assert.deepEqual(result.inventoryDelta,{oak_log:-1,oak_planks:4});
  assert.equal(result.healthDelta,-2);
  recordAction(memory,action,before,before,new Error('No path'),0.8,Date.now());
  const first = memory.failures['overworld:craft'].retryAfter;
  recordAction(memory,action,before,before,new Error('No path'),0.8,Date.now());
  assert.ok(memory.failures['overworld:craft'].retryAfter > first);
});
