import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { Actions } from '../src/actions.js';
import { JevClient } from '../src/jev.js';

test('skills expose non-progression recipes and blocks regardless of stockpile quotas',()=>{
 const pos=new Vec3(2,64,0);
 const block={name:'oak_log',position:pos,diggable:true,boundingBox:'block',canHarvest:()=>true};
 const bot={entity:{position:new Vec3(0,64,0)},food:20,inventory:{items:()=>[{name:'oak_log',count:64,type:1}]},
  registry:{itemsArray:[{id:2,name:'oak_button'}],itemsByName:{oak_button:{id:2}},blocksByName:{oak_log:{id:1}}},
  recipesFor:()=>[{result:{count:1}}],findBlock:()=>null,canSeeBlock:()=>true,
  findBlocks:({matching,useExtraInfo})=>{
   // Reproduce Mineflayer's palette preflight, then its positioned filter.
   assert.equal(matching({...block,position:null}),true);
   assert.equal(matching(null),false);
   assert.equal(useExtraInfo({...block,position:null}),false);
   assert.equal(useExtraInfo({...block,position:new Vec3(0,63,0)}),false);
   return matching(block) && useExtraInfo(block)?[pos]:[];
  },blockAt:p=>p.equals(pos)?block:p.y===63?{name:'stone',boundingBox:'block'}:{name:'air',boundingBox:'empty'}};
 const actions=new Actions(bot,{visits:{},failures:{}}).candidates({position:{x:0,y:64,z:0},dimension:'overworld',inventory:{oak_log:64},entities:[{id:9,name:'enderman',position:{x:3,y:64,z:0},distance:3}],memory:{},equipped:[]});
 assert.ok(actions.some(a=>a.id==='craft_oak_button'));
 assert.ok(actions.some(a=>a.skill==='mine'));
 assert.ok(actions.some(a=>a.id==='fight_9'));
 assert.ok(actions.some(a=>a.skill==='place' && a.parameterGroup==='oak_log'));
 assert.ok(!actions.some(a=>/build_portal|return_portal|fill_frame/.test(a.id)));
});
test('Jev selects skill then target and quantity; no fixed craft stage overrides its choice',async()=>{
 let calls=0;
 const client=new JevClient({key:'test',fetchImpl:async(url,opts)=>{
  const body=JSON.parse(opts.body);calls++;
  const criteria=body.questions.action.criteria;
  if(calls===1) { assert.deepEqual(Object.keys(criteria),['craft','explore']);return Response.json({answers:{action:{type:'choice',choice:'craft',confidence:0.9}}}); }
  assert.deepEqual(Object.keys(criteria),['craft_button']);
  return Response.json({answers:{action:{type:'choice',choice:'craft_button',confidence:0.8},quantity:{type:'choice',choice:'4',confidence:0.9}}});
 }});
 const choice=await client.chooseAction({},[{id:'craft_button',skill:'craft',description:'Craft button',maxQuantity:4},{id:'explore_north',skill:'explore',description:'Explore north'}]);
 assert.equal(choice.id,'craft_button');assert.equal(choice.quantity,4);assert.equal(choice.confidence,0.8);assert.equal(calls,2);
});
test('placement selects material before coordinates to bound parameter context',async()=>{
 const answers=['place','dirt','place_dirt_1_2_3'];let index=0;
 const client=new JevClient({key:'test',fetchImpl:async(url,opts)=>{
  const body=JSON.parse(opts.body);const choice=answers[index++];
  assert.ok(Object.hasOwn(body.questions.action.criteria,choice));
  return Response.json({answers:{action:{type:'choice',choice,confidence:0.9}}});
 }});
 const choice=await client.chooseAction({},[{id:'place_dirt_1_2_3',skill:'place',parameterGroup:'dirt',description:'Place dirt at (1,2,3)'},{id:'place_stone_1_2_3',skill:'place',parameterGroup:'stone',description:'Place stone at (1,2,3)'}]);
 assert.equal(choice.id,'place_dirt_1_2_3');assert.equal(index,3);
});
