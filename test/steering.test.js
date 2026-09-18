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

test('full skill and target decisions execute with no initial microgoal while Luna is pending',async()=>{
 const {JevClient}=await import('../src/jev.js');
 const {executionContext}=await import('../src/context.js');
 let finish;const steering=new Steering({propose:()=>new Promise(resolve=>finish=resolve)});
 steering.request({},[],'initial_microgoal',1);await setImmediate();
 let executed=0;
 const candidates=[{id:'mine_1_2_3',skill:'mine',description:'Mine visible stone',run:async()=>{executed++;}}];
 const jev=new JevClient({key:'test',fetchImpl:async(url,opts)=>{
  const body=JSON.parse(opts.body);
  assert.equal(body.state.executionPolicy.mode,'self_directed');
  assert.equal(body.state.executionPolicy.plannerPending,true);
  const choice=Object.keys(body.questions.action.criteria)[0];
  return Response.json({answers:{action:{type:'choice',choice,confidence:0.9}}});
 }});
 for(let i=0;i<3;i++) {
  const choice=await jev.chooseAction({steering:steering.status()},candidates);
  await candidates.find(a=>a.id===choice.id).run();
 }
 assert.equal(executed,3);assert.equal(steering.pending,true);
 const proposal={description:'Craft stone pickaxe',steps:['Use the collected stone'],completion:[{kind:'inventory',key:'stone_pickaxe',target:1}]};
 finish(proposal);await setImmediate();
 assert.equal(steering.status().adviceReady,true);
 const advice=steering.take();
 const context=executionContext({inventory:{cobblestone:3},memory:{plan:advice.proposal},steering:steering.status()},candidates);
 assert.equal(context.executionPolicy.mode,'microgoal_guided');
 assert.equal(context.inventory.cobblestone,3);assert.equal(executed,3);
});
