import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Steering } from '../src/steering.js';

test('slow background planner leaves actions free and prevents overlapping reviews',async()=>{
 let resolve;
 const steering=new Steering({propose:()=>new Promise(r=>resolve=r)});
 assert.equal(steering.request({},[],'initial',1,undefined,0),true);
 await setImmediate();
 let actions=0;
 for(let i=0;i<5;i++) await Promise.resolve().then(()=>actions++);
 assert.equal(actions,5); assert.equal(steering.pending,true);
 assert.equal(steering.request({},[],'initial',1,undefined,150000),false);
 assert.equal(steering.take(),null);
 resolve({description:'useful advice'}); await setImmediate();
 assert.equal(steering.pending,false);
 assert.equal(steering.request({},[],'initial',1,undefined,150000),false);
 assert.equal(steering.take().epoch,1);
 assert.equal(steering.request({},[],'review',1,undefined,119999),false);
 assert.equal(steering.request({},[],'review',1,undefined,120000),true);
 await setImmediate(); resolve({}); await setImmediate();
});

test('planner rejection becomes advisory error without throwing into action execution',async()=>{
 const steering=new Steering({propose:async()=>{throw new Error('unavailable');}});
 steering.request({},[],'initial',2); await setImmediate();
 assert.equal(steering.take().error.message,'unavailable');
 assert.equal(steering.pending,false); assert.equal(steering.take(),null);
});

test('actual Luna client can wait on a response while Jev decisions and actions continue',async()=>{
 const {LunaPlanner}=await import('../src/luna.js');
 const {JevClient}=await import('../src/jev.js');
 let release;let started=false;
 const luna=new LunaPlanner({key:'test',fetchImpl:async()=>{
  started=true;await new Promise(r=>release=r);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{}'}]}]});
 }});
 const steering=new Steering(luna);
 const jev=new JevClient({key:'test',fetchImpl:async()=>Response.json({answers:{action:{type:'choice',choice:'craft',confidence:0.9}}})});
 steering.request({},[],'initial',1);await setImmediate();
 assert.equal(started,true);
 let actions=0;
 for(let i=0;i<3;i++) {
  const choice=await jev.choose({},[{id:'craft',description:'Craft upgrade'}]);
  if(choice.id==='craft') actions++;
 }
 assert.equal(actions,3);assert.equal(steering.pending,true);assert.equal(steering.take(),null);
 release();await setImmediate();assert.deepEqual(steering.take().proposal,{});
});
