import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installDeathRecovery } from '../src/recovery.js';
test('death cancels old work and clears its plan; spawn resumes same controller',()=>{
 const bot=new EventEmitter();let epoch=0,cancelled=0;
 const memory={plan:{id:'old'},current:{health:0},eyeTarget:{x:1}};
 const events=[];
 const state=installDeathRecovery(bot,{memory,invalidate:()=>epoch++,cancel:()=>cancelled++,log:e=>events.push(e),isStopped:()=>false});
 bot.emit('spawn');assert.equal(state.waiting,false);
 bot.emit('death');assert.equal(state.waiting,true);assert.equal(epoch,1);assert.equal(cancelled,1);
 assert.equal(memory.plan,null);assert.equal(memory.planHistory[0].outcome,'died');assert.equal(memory.eyeTarget,null);
 bot.emit('spawn');assert.equal(state.waiting,false);assert.deepEqual(events,['death','respawned']);
});
test('stopped runs cannot resume from a late death or spawn event',()=>{
 const bot=new EventEmitter();
 const state=installDeathRecovery(bot,{memory:{},invalidate:()=>assert.fail(),cancel:()=>assert.fail(),log:()=>assert.fail(),isStopped:()=>true});
 bot.emit('death');bot.emit('spawn');assert.equal(state.waiting,false);
});
