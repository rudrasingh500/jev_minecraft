import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { Capabilities } from '../src/capabilities.js';

const air = p => ({name:'air',position:p,boundingBox:'empty'});
const solid = (name,p,extra={}) => ({name,position:p,boundingBox:'block',...extra});

function ownerFor(bot,memory={}) {
  return {bot,memory,signal:new AbortController().signal,near:async()=>{},equip:async name=>{bot.heldItem=bot.inventory.items().find(i=>i.name===name);}};
}

function collector() {
  const actions=[];
  return {actions,add:(skill,target,description,run,maxQuantity=1,parameterGroup,parameterGroupDescription,extra={})=>actions.push({id:`${skill}_${target}`,skill,description,run,maxQuantity,parameterGroup,parameterGroupDescription,...extra})};
}

test('extended capabilities expose grounded targets for every requested skill family',()=>{
  const blocks=new Map();
  const put=block=>blocks.set(block.position.toString(),block);
  const chest=solid('chest',new Vec3(2,64,0));put(chest);
  const water=solid('water',new Vec3(3,64,0),{boundingBox:'empty',getProperties:()=>({level:0})});put(water);
  const bed=solid('red_bed',new Vec3(4,64,0));put(bed);
  const farmland=solid('farmland',new Vec3(1,63,1));put(farmland);
  const emptyFarmland=solid('farmland',new Vec3(3,63,1));put(emptyFarmland);
  const dirt=solid('dirt',new Vec3(-1,63,1));put(dirt);
  const wheat=solid('wheat',new Vec3(1,64,1),{boundingBox:'empty',getProperties:()=>({age:7})});put(wheat);
  const carrots=solid('carrots',new Vec3(2,64,1),{boundingBox:'empty',getProperties:()=>({age:2})});put(carrots);
  const items=[
    {name:'oak_log',count:12,type:1,metadata:0},{name:'bucket',count:1,type:2,metadata:0},
    {name:'water_bucket',count:1,type:3,metadata:0},{name:'iron_hoe',count:1,type:4,metadata:0},
    {name:'wheat_seeds',count:4,type:5,metadata:0},{name:'bone_meal',count:2,type:6,metadata:0},
    {name:'oak_boat',count:1,type:7,metadata:0},{name:'emerald',count:5,type:8,metadata:0}
  ];
  const villager={id:7,uuid:'villager-7',name:'villager',position:new Vec3(2,64,2)};
  const cow={id:8,name:'cow',position:new Vec3(2,64,3)};
  const boat={id:9,name:'boat',position:new Vec3(3,64,1)};
  const bot={
    entity:{position:new Vec3(0,64,0),isInWater:false},entities:{7:villager,8:cow,9:boat},heldItem:null,
    time:{timeOfDay:13000},isRaining:false,thunderState:0,isABed:b=>/_bed$/.test(b?.name || ''),
    inventory:{items:()=>items},blockAt:p=>blocks.get(p.toString()) || air(p),
    findBlocks:({matching,count})=>[...blocks.values()].filter(matching).slice(0,count).map(b=>b.position)
  };
  const memory={containerViews:{},tradeViews:{}};
  const capabilities=new Capabilities(ownerFor(bot,memory));
  memory.containerViews[capabilities.containerKey('overworld',chest.position)]={contents:{apple:3},lastSeen:1};
  memory.tradeViews[capabilities.tradeKey('overworld',villager)]={offers:[{index:0,disabled:false,remaining:4,input1:{name:'emerald',count:1},input2:null,output:{name:'bread',count:6}}]};
  const {actions,add}=collector();
  capabilities.addCandidates({dimension:'overworld',position:{x:0,y:64,z:0},inventory:Object.fromEntries(items.map(i=>[i.name,i.count])),entities:[
    {id:7,name:'villager',position:{x:2,y:64,z:2}},{id:8,name:'cow',position:{x:2,y:64,z:3}},{id:9,name:'boat',position:{x:3,y:64,z:1}}
  ]},add,{placements:[new Vec3(0,64,2)]});
  for(const skill of ['container','trade','sleep','swim','boat','farm','bucket','coordinate_move'])assert.ok(actions.some(a=>a.skill===skill),`missing ${skill}`);
  assert.ok(actions.some(a=>a.id.startsWith('container_withdraw_apple_')));
  assert.ok(actions.some(a=>a.id==='trade_execute_7_0'));
  assert.ok(actions.some(a=>a.id.startsWith('farm_harvest_')));
  assert.ok(actions.some(a=>a.id.startsWith('farm_plant_wheat_seeds_')));
  assert.ok(actions.some(a=>a.id.startsWith('farm_fertilize_')));
  assert.ok(actions.some(a=>a.id==='bucket_milk_8'));
  const coordinate=actions.find(a=>a.id==='coordinate_move_local');
  assert.equal(actions.filter(a=>a.skill==='coordinate_move').length,1);
  assert.equal(coordinate.coordinateOptions.x.length,129);
  assert.equal(coordinate.coordinateOptions.z.length,129);
});

test('container inspection persists contents and transfers selected quantities',async()=>{
  const position=new Vec3(2,64,0);const chestBlock=solid('chest',position);
  let stored=[{name:'apple',count:6,type:4,metadata:0}],closed=0,deposit,withdraw;
  const window={containerItems:()=>stored,close:async()=>{closed++;},deposit:async(...args)=>{deposit=args;},withdraw:async(...args)=>{withdraw=args;}};
  const inventoryItems=[{name:'oak_log',count:10,type:1,metadata:0}];
  const bot={entity:{position:new Vec3(0,64,0)},inventory:{items:()=>inventoryItems},blockAt:()=>chestBlock,openContainer:async()=>window};
  const memory={};const capabilities=new Capabilities(ownerFor(bot,memory));
  await capabilities.inspectContainer('overworld',position);
  assert.deepEqual(memory.containerViews['overworld:2_64_0'].contents,{apple:6});
  await capabilities.transferContainer('overworld',position,'oak_log','deposit',4);
  await capabilities.transferContainer('overworld',position,'apple','withdraw',2);
  assert.deepEqual(deposit,[1,0,4]);assert.deepEqual(withdraw,[4,0,2]);assert.equal(closed,3);
});

test('villager offers are inspected before an affordable trade executes',async()=>{
  const entity={id:7,uuid:'v7',name:'villager',position:new Vec3(1,64,0)};
  const offer={tradeDisabled:false,maximumNbTradeUses:12,nbTradeUses:2,realPrice:2,inputItem1:{name:'emerald',count:1},hasItem2:false,inputItem2:null,outputItem:{name:'bread',count:6}};
  let traded,closed=0;
  const window={trades:[offer],close:async()=>{closed++;}};
  const bot={entities:{7:entity},openVillager:async()=>window,trade:async(...args)=>{traded=args;},inventory:{items:()=>[]}};
  const memory={};const capabilities=new Capabilities(ownerFor(bot,memory));
  await capabilities.inspectTrades('overworld',7);
  assert.equal(memory.tradeViews['overworld:v7'].offers[0].output.name,'bread');
  await capabilities.executeTrade('overworld',7,0,3);
  assert.deepEqual(traded,[window,0,3]);assert.equal(closed,2);
});

test('sleeping and mounted states expose only valid exclusive controls',()=>{
  const sleepingBot={isSleeping:true};const sleeping=collector();
  assert.equal(new Capabilities(ownerFor(sleepingBot)).exclusiveCandidates({},sleeping.add),true);
  assert.deepEqual(sleeping.actions.map(a=>a.id),['sleep_continue','sleep_wake']);
  const boatBot={vehicle:{name:'boat'}};const mounted=collector();
  assert.equal(new Capabilities(ownerFor(boatBot)).exclusiveCandidates({},mounted.add),true);
  assert.equal(mounted.actions.filter(a=>a.id.startsWith('boat_travel_')).length,32);
  assert.ok(mounted.actions.some(a=>a.id==='boat_dismount'));
});
