import test from 'node:test';
import assert from 'node:assert/strict';
import { LunaPlanner } from '../src/luna.js';
import { completed, reviewReason, validateMicrogoal, adoptMicrogoal } from '../src/microgoals.js';
const state={dimension:'overworld',position:{x:0,y:65,z:0},inventory:{},equipped:[],observedBlocks:[],objective:'Beat the Ender Dragon'};
const proposal={description:'Acquire an iron pickaxe',rationale:'Unlock harder resources',steps:['Gather and smelt iron','Craft a pickaxe'],completion:[{kind:'inventory',key:'iron_pickaxe',target:1}]};
const registry={itemsByName:{iron_pickaxe:{}},blocksByName:{}};
test('Luna microgoal persists across turns and replans on measured completion',()=>{
 const memory={};adoptMicrogoal(memory,validateMicrogoal(proposal,state,registry),state,'initial_microgoal');
 memory.plan.actionsTaken=20;
 assert.equal(reviewReason(memory,state),null);
 assert.equal(reviewReason(memory,{...state,inventory:{iron_pickaxe:1}},memory.plan.selectedAt+120001),'microgoal_completed');
 assert.equal(memory.plan.objective,'Beat the Ender Dragon');
 assert.equal(memory.plan.selectedBy,'gpt-5.6-luna');
});
test('planner gives Jev recovery time and rate-limits completion reviews',()=>{
 const memory={recent:[]};adoptMicrogoal(memory,proposal,state,'initial_microgoal');
 const start=memory.plan.selectedAt;
 memory.plan.failures=3;memory.plan.noProgress=6;
 assert.equal(reviewReason(memory,state,start+90000),null);
 assert.equal(reviewReason(memory,{...state,inventory:{iron_pickaxe:1}},start+30000),null);
 assert.equal(memory.plan.status,'completed');
 assert.equal(reviewReason(memory,{...state,dimension:'the_nether'},start+120001),'dimension_changed');
 assert.equal(reviewReason(memory,state,start+300001),'stalled');
});
test('many failed approaches trigger review only after sustained evidence',()=>{
 const memory={recent:[]};adoptMicrogoal(memory,proposal,state,'initial_microgoal');
 const start=memory.plan.selectedAt;
 memory.recent=Array.from({length:8},(_,i)=>({started:start+1,action:'mine_'+i,result:'failed'}));
 assert.equal(reviewReason(memory,state,start+60000),null);
 assert.equal(reviewReason(memory,state,start+300001),'repeated_action_failures');
});
test('rejects the observed wandering and gravel microgoals',()=>{
 for(const completion of [[{kind:'travel_distance',key:'',target:20}],[{kind:'inventory',key:'gravel',target:1}]]) {
  assert.throws(()=>validateMicrogoal({...proposal,completion},state,registry),/useful readiness/);
 }
});
test('accepts standard Minecraft namespaced item identifiers',()=>{
 const plan=validateMicrogoal({...proposal,completion:[{kind:'inventory',key:'minecraft:iron_pickaxe',target:1}]},state,registry);
 assert.equal(plan.completion[0].key,'iron_pickaxe');
 assert.equal(completed(plan,{...state,inventory:{iron_pickaxe:1}}),true);
});
test('rejects unknown and already satisfied predicates and requires all conditions',()=>{
 assert.throws(()=>validateMicrogoal({...proposal,completion:[{kind:'eval',key:'code',target:1}]},state,registry),/Unsupported/);
 assert.throws(()=>validateMicrogoal(proposal,{...state,inventory:{iron_pickaxe:1}},registry),/already-completed/);
 const plan={...proposal,completion:[...proposal.completion,{kind:'dimension',key:'minecraft:the_nether',target:0}]};
 assert.equal(completed(plan,{...state,inventory:{iron_pickaxe:1}}),false);
 assert.equal(completed(plan,{...state,inventory:{iron_pickaxe:1},dimension:'the_nether'}),true);
});
test('Luna uses the requested model and strict structured responses without storing secrets in input',async()=>{
 const planner=new LunaPlanner({key:'test-only',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(options.body);
  assert.equal(body.model,'gpt-5.6-luna');assert.equal(body.store,false);
  assert.equal(body.text.format.strict,true);assert.ok(!options.body.includes('test-only'));
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}],usage:{input_tokens:10,output_tokens:10}});
 }});
 assert.deepEqual(await planner.propose(state,[],'initial_microgoal'),proposal);
 assert.equal(planner.requests,1);
});
test('Luna failures expose status only, and incomplete responses are rejected',async()=>{
 const failed=new LunaPlanner({key:'test-only',fetchImpl:async()=>new Response('secret echo',{status:401})});
 await assert.rejects(failed.propose(state,[],'initial'),error=>error.message==='Luna HTTP 401');
 const incomplete=new LunaPlanner({key:'test-only',fetchImpl:async()=>Response.json({status:'incomplete'})});
 await assert.rejects(incomplete.propose(state,[],'initial'),/did not complete/);
});

test('placed workstations satisfy availability and achieved goals stay completed after leaving',()=>{
 const plan={...proposal,completion:[{kind:'inventory',key:'crafting_table',target:1},{kind:'inventory',key:'wooden_pickaxe',target:1}]};
 assert.equal(completed(plan,{...state,inventory:{wooden_pickaxe:1},observedBlocks:['crafting_table']}),true);
 const memory={};adoptMicrogoal(memory,plan,state,'initial');
 memory.plan.completedAt=Date.now();
 assert.equal(reviewReason(memory,state,memory.plan.selectedAt+120001),'microgoal_completed');
});
