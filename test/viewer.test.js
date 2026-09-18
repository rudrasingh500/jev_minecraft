import test from 'node:test';
import assert from 'node:assert/strict';
import chunkLoader from 'prismarine-chunk';
import blockLoader from 'prismarine-block';
import { Vec3 } from 'vec3';
import { makeDisplayMapper, startViewer } from '../src/viewer.js';
test('26.1 display mapping preserves block names/properties and chunk coordinates', () => {
  const Block = blockLoader('26.1');
  const TargetBlock = blockLoader('1.21.4');
  const SourceChunk = chunkLoader('26.1');
  const TargetChunk = chunkLoader('1.21.4');
  const chunk = new SourceChunk({minY:0,worldHeight:16});
  const pos = new Vec3(3,4,5);
  const log = Block.fromProperties('oak_log',{axis:'x'},0);
  chunk.setBlockStateId(pos,log.stateId);
  const mapper = makeDisplayMapper('26.1');
  const rendered = TargetChunk.fromJson(mapper.chunk(chunk.toJson()));
  const block = TargetBlock.fromStateId(rendered.getBlockStateId(pos),0);
  assert.equal(block.name,'oak_log');
  assert.equal(block.getProperties().axis,'x');
  assert.equal(chunk.getBlockStateId(pos),log.stateId);
});
test('viewer serves recording controls and sanitized state on loopback', async () => {
  // No game or API connection: verify HTTP startup and cleanup with a fake bot.
  const viewer = await startViewer({version:'26.1'}, {port:0,memory:{recent:[],current:{health:20}}});
  try {
    const base = `http://127.0.0.1:${viewer.port}`;
    assert.match(await (await fetch(base)).text(), /recorder.js/);
    assert.match(await (await fetch(base+'/recorder.js')).text(), /MediaRecorder/);
    assert.equal((await (await fetch(base+'/state')).json()).current.health,20);
  } finally { viewer.close(); }
});

test('viewer exposes live inventory and goal checks without mutating stored observations',async()=>{
 const {viewerState}=await import('../src/viewer.js');
 const memory={current:{inventory:{},dimension:'overworld',observedBlocks:['crafting_table']},recent:[],plan:{completion:[{kind:'inventory',key:'iron_pickaxe',target:1}]}};
 const bot={version:'26.1',entity:{position:{x:1,y:2,z:3}},health:18,food:16,heldItem:{name:'iron_pickaxe'},inventory:{items:()=>[{name:'iron_pickaxe',count:1}],slots:[]}};
 const data=viewerState(bot,memory);
 assert.equal(data.current.inventory.iron_pickaxe,1);assert.equal(data.current.heldItem,'iron_pickaxe');
 assert.equal(data.completion[0].satisfied,true);assert.deepEqual(memory.current.inventory,{});
});
