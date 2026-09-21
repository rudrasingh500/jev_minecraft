import pathfinderPackage from 'mineflayer-pathfinder';
import vec3Package from 'vec3';
import { setTimeout as sleep } from 'node:timers/promises';
import { navigate } from './navigation.js';

const { goals } = pathfinderPackage;
const { Vec3 } = vec3Package;
const v = p => new Vec3(p.x,p.y,p.z);
const air = block => !block || /^(air|cave_air|void_air)$/.test(block.name);
const idAt = p => `${p.x}_${p.y}_${p.z}`;
const containerBlock = block => /^(chest|trapped_chest|barrel|ender_chest|hopper|dispenser|dropper|.+_shulker_box)$/.test(block?.name || '');
const boatEntity = entity => /boat|raft/.test(entity?.name || '');
const matureAge = {wheat:7,carrots:7,potatoes:7,beetroots:3,nether_wart:3,cocoa:2,sweet_berry_bush:3,torchflower_crop:1,pitcher_crop:4};
const plantable = {
  farmland:['wheat_seeds','carrot','potato','beetroot_seeds','pumpkin_seeds','melon_seeds','torchflower_seeds','pitcher_pod'],
  soul_sand:['nether_wart']
};
const fluidBucket = name => /_bucket$/.test(name) && !/^(bucket|milk_bucket)$/.test(name);
const horizontalDirections = [
  ['north',0,-1],['northeast',1,-1],['east',1,0],['southeast',1,1],
  ['south',0,1],['southwest',-1,1],['west',-1,0],['northwest',-1,-1]
];

function aggregate(items) {
  const result={};
  for(const item of items || [])result[item.name]=(result[item.name] || 0)+item.count;
  return result;
}

function properties(block) {
  try { return block?.getProperties?.() || {}; } catch { return {}; }
}

export class Capabilities {
  constructor(actions) { this.actions=actions; }
  get bot() { return this.actions.bot; }
  get memory() { return this.actions.memory; }
  get signal() { return this.actions.signal; }

  blockPositions(test,maxDistance=16,count=24) {
    if(!this.bot.findBlocks)return [];
    return this.bot.findBlocks({matching:b=>!!b && test(b),maxDistance,count})
      .map(p=>v(p)).filter(p=>test(this.bot.blockAt(p)));
  }

  containerKey(dimension,position) { return `${dimension}:${idAt(position)}`; }
  tradeKey(dimension,entity) { return `${dimension}:${entity.uuid || entity.id}`; }

  rememberContainer(dimension,block,window) {
    this.memory.containerViews ||= {};
    const key=this.containerKey(dimension,block.position);
    this.memory.containerViews[key]={name:block.name,dimension,position:{x:block.position.x,y:block.position.y,z:block.position.z},contents:aggregate(window.containerItems()),lastSeen:Date.now()};
    const ordered=Object.entries(this.memory.containerViews).sort((a,b)=>b[1].lastSeen-a[1].lastSeen);
    for(const [oldKey] of ordered.slice(64))delete this.memory.containerViews[oldKey];
    return this.memory.containerViews[key];
  }

  async withContainer(dimension,position,operation) {
    await this.actions.near(position,3);
    const block=this.bot.blockAt(v(position));
    if(!containerBlock(block))throw new Error('Container disappeared');
    const window=await this.bot.openContainer(block);
    try { return await operation(window,block); }
    finally { await window.close(); }
  }

  async inspectContainer(dimension,position) {
    await this.withContainer(dimension,position,async(window,block)=>this.rememberContainer(dimension,block,window));
  }

  async transferContainer(dimension,position,itemName,direction,quantity) {
    await this.withContainer(dimension,position,async(window,block)=>{
      const items=direction==='deposit' ? this.bot.inventory.items() : window.containerItems();
      const item=items.find(i=>i.name===itemName);
      if(!item)throw new Error(`${itemName} is no longer available to ${direction}`);
      const available=items.filter(i=>i.type===item.type && i.metadata===item.metadata).reduce((sum,i)=>sum+i.count,0);
      const count=Math.max(1,Math.min(quantity,available));
      if(direction==='deposit')await window.deposit(item.type,item.metadata ?? null,count);
      else await window.withdraw(item.type,item.metadata ?? null,count);
      this.rememberContainer(dimension,block,window);
    });
  }

  rememberTrades(dimension,entity,villager) {
    this.memory.tradeViews ||= {};
    const key=this.tradeKey(dimension,entity);
    this.memory.tradeViews[key]={dimension,entityId:entity.id,uuid:entity.uuid,position:{x:entity.position.x,y:entity.position.y,z:entity.position.z},lastSeen:Date.now(),offers:villager.trades.map((trade,index)=>({
      index,disabled:!!trade.tradeDisabled,remaining:Math.max(0,trade.maximumNbTradeUses-trade.nbTradeUses),
      input1:{name:trade.inputItem1.name,count:trade.realPrice || trade.inputItem1.count},
      input2:trade.hasItem2 ? {name:trade.inputItem2.name,count:trade.inputItem2.count} : null,
      output:{name:trade.outputItem.name,count:trade.outputItem.count}
    }))};
    const ordered=Object.entries(this.memory.tradeViews).sort((a,b)=>b[1].lastSeen-a[1].lastSeen);
    for(const [oldKey] of ordered.slice(32))delete this.memory.tradeViews[oldKey];
    return this.memory.tradeViews[key];
  }

  async withVillager(dimension,id,operation) {
    const initial=this.bot.entities[id];
    if(initial?.name!=='villager')throw new Error('Villager disappeared');
    await this.actions.near(initial.position,2);
    const entity=this.bot.entities[id];
    if(entity?.name!=='villager')throw new Error('Villager disappeared');
    const window=await this.bot.openVillager(entity);
    try { return await operation(window,entity); }
    finally { await window.close(); }
  }

  async inspectTrades(dimension,id) {
    await this.withVillager(dimension,id,async(window,entity)=>this.rememberTrades(dimension,entity,window));
  }

  async executeTrade(dimension,id,index,quantity) {
    await this.withVillager(dimension,id,async(window,entity)=>{
      const offer=window.trades[index];
      if(!offer || offer.tradeDisabled)throw new Error('Trade is no longer available');
      const remaining=offer.maximumNbTradeUses-offer.nbTradeUses;
      await this.bot.trade(window,index,Math.max(1,Math.min(quantity,remaining)));
      this.rememberTrades(dimension,entity,window);
    });
  }

  async sleepIn(position) {
    await this.actions.near(position,2);
    const bed=this.bot.blockAt(v(position));
    if(!this.bot.isABed(bed))throw new Error('Bed disappeared');
    await this.bot.sleep(bed);
  }

  async remainAsleep(signal) {
    const deadline=Date.now()+10000;
    while(this.bot.isSleeping && Date.now()<deadline)await sleep(250,undefined,{signal});
  }

  async swimHorizontal(dx,dz,distance,signal) {
    if(!this.bot.entity.isInWater)throw new Error('Not in water');
    const start=this.bot.entity.position.clone();
    const scale=distance/Math.hypot(dx,dz);
    const target=start.offset(dx*scale,1.2,dz*scale);
    await this.bot.lookAt(target,true);
    this.bot.setControlState('forward',true);this.bot.setControlState('sprint',true);
    try {
      while(this.bot.entity.isInWater && Math.hypot(this.bot.entity.position.x-start.x,this.bot.entity.position.z-start.z)<distance)await sleep(100,undefined,{signal});
    } finally { this.bot.setControlState('forward',false);this.bot.setControlState('sprint',false); }
    const moved=Math.hypot(this.bot.entity.position.x-start.x,this.bot.entity.position.z-start.z);
    if(moved<Math.min(1,distance/2))throw new Error('Swimming made no useful progress');
  }

  async swimVertical(direction,distance,signal) {
    if(!this.bot.entity.isInWater)throw new Error('Not in water');
    const startY=this.bot.entity.position.y;
    const control=direction==='surface'?'jump':'sneak';
    this.bot.setControlState(control,true);
    try {
      while(this.bot.entity.isInWater && Math.abs(this.bot.entity.position.y-startY)<distance)await sleep(100,undefined,{signal});
    } finally { this.bot.setControlState(control,false); }
    if(direction==='dive' && startY-this.bot.entity.position.y<Math.min(0.5,distance/2))throw new Error('Dive made no useful progress');
  }

  async enterWater(position) {
    const block=this.bot.blockAt(v(position));
    if(block?.name!=='water')throw new Error('Water target disappeared');
    await navigate(this.bot,new goals.GoalBlock(position.x,position.y,position.z),8000);
  }

  async launchBoat(itemName,position) {
    await this.actions.near(position,2);
    await this.actions.equip(itemName);
    const water=this.bot.blockAt(v(position));
    if(water?.name!=='water')throw new Error('Boat launch water disappeared');
    if(itemName.endsWith('_raft')) {
      await this.bot.activateBlock(water,new Vec3(0,1,0));
      await sleep(500,undefined,{signal:this.signal});
    } else await this.bot.placeEntity(water,new Vec3(0,1,0));
  }

  async mountBoat(id) {
    const initial=this.bot.entities[id];
    if(!boatEntity(initial))throw new Error('Boat disappeared');
    await this.actions.near(initial.position,2);
    const entity=this.bot.entities[id];
    if(!boatEntity(entity))throw new Error('Boat disappeared');
    this.bot.mount(entity);
    const deadline=Date.now()+2500;
    while(!this.bot.vehicle && Date.now()<deadline)await sleep(50,undefined,{signal:this.signal});
    if(!this.bot.vehicle)throw new Error('Failed to mount boat');
  }

  async travelBoat(dx,dz,distance,signal) {
    if(!boatEntity(this.bot.vehicle))throw new Error('Not mounted in a boat');
    const start=this.bot.entity.position.clone();
    const scale=distance/Math.hypot(dx,dz);
    await this.bot.lookAt(start.offset(dx*scale,1,dz*scale),true);
    try {
      while(this.bot.vehicle && Math.hypot(this.bot.entity.position.x-start.x,this.bot.entity.position.z-start.z)<distance) {
        this.bot.moveVehicle(0,1);await sleep(100,undefined,{signal});
      }
    } finally { this.bot.moveVehicle(0,0); }
    const moved=Math.hypot(this.bot.entity.position.x-start.x,this.bot.entity.position.z-start.z);
    if(moved<Math.min(2,distance/2))throw new Error('Boat made no useful progress');
  }

  async harvest(position) {
    await this.actions.near(position,2);
    const block=this.bot.blockAt(v(position));
    if(!block || !(block.name in matureAge || /^(melon|pumpkin)$/.test(block.name)))throw new Error('Crop disappeared');
    if(block.name in matureAge && Number(properties(block).age)<matureAge[block.name])throw new Error('Crop is no longer mature');
    if(!this.bot.canDigBlock(block))throw new Error('Crop is out of reach');
    await this.bot.dig(block);
  }

  async till(position,hoe) {
    await this.actions.near(position,3);await this.actions.equip(hoe);
    const block=this.bot.blockAt(v(position));
    if(!/^(dirt|grass_block|coarse_dirt|rooted_dirt)$/.test(block?.name || ''))throw new Error('Tillable soil disappeared');
    if(!air(this.bot.blockAt(block.position.offset(0,1,0))))throw new Error('Space above the soil is occupied');
    await this.bot.activateBlock(block,new Vec3(0,1,0));
  }

  async plant(position,itemName) {
    await this.actions.near(position,3);await this.actions.equip(itemName);
    const base=this.bot.blockAt(v(position));
    if(!plantable[base?.name]?.includes(itemName))throw new Error('Planting surface disappeared');
    if(!air(this.bot.blockAt(base.position.offset(0,1,0))))throw new Error('Planting space is occupied');
    await this.bot.activateBlock(base,new Vec3(0,1,0));
  }

  async fertilize(position) {
    await this.actions.near(position,3);await this.actions.equip('bone_meal');
    const crop=this.bot.blockAt(v(position));
    if(!(crop?.name in matureAge))throw new Error('Crop disappeared');
    if(Number(properties(crop).age)>=matureAge[crop.name])throw new Error('Crop is already mature');
    await this.bot.activateBlock(crop,new Vec3(0,1,0));
  }

  async collectBucket(position,fluid) {
    await this.actions.near(position,3);await this.actions.equip('bucket');
    const block=this.bot.blockAt(v(position));
    if(block?.name!==fluid)throw new Error(`${fluid} source disappeared`);
    const level=properties(block).level;
    if(level!==undefined && Number(level)!==0)throw new Error(`${fluid} is flowing rather than a source block`);
    await this.bot.activateBlock(block,new Vec3(0,1,0));
  }

  async emptyBucket(itemName,position) {
    const p=v(position);await this.actions.near(p,3);await this.actions.equip(itemName);
    if(!air(this.bot.blockAt(p)))throw new Error('Bucket destination is occupied');
    for(const d of [new Vec3(0,-1,0),new Vec3(-1,0,0),new Vec3(1,0,0),new Vec3(0,0,-1),new Vec3(0,0,1)]) {
      const ref=this.bot.blockAt(p.plus(d));
      if(ref?.boundingBox==='block') { await this.bot.activateBlock(ref,d.scaled(-1));return; }
    }
    throw new Error('No support face for bucket destination');
  }

  async milk(id) {
    const initial=this.bot.entities[id];
    if(!/^(cow|goat|mooshroom)$/.test(initial?.name || ''))throw new Error('Milkable animal disappeared');
    await this.actions.near(initial.position,2);await this.actions.equip('bucket');
    const entity=this.bot.entities[id];if(!entity)throw new Error('Milkable animal disappeared');
    await this.bot.activateEntity(entity);
  }

  async moveCoordinate(parameters,allowedX,allowedZ) {
    const x=Number(parameters?.x),z=Number(parameters?.z);
    if(!allowedX.includes(x) || !allowedZ.includes(z))throw new Error('Coordinate selection is outside the available local range');
    const distance=Math.hypot(x-this.bot.entity.position.x,z-this.bot.entity.position.z);
    await navigate(this.bot,new goals.GoalXZ(x,z),Math.min(19000,6000+distance*200));
  }

  exclusiveCandidates(state,add) {
    if(this.bot.isSleeping) {
      add('sleep','continue','Remain asleep while night advances',signal=>this.remainAsleep(signal));
      add('sleep','wake','Wake from the bed now',()=>this.bot.wake());
      return true;
    }
    if(boatEntity(this.bot.vehicle)) {
      for(const [direction,dx,dz] of horizontalDirections)for(const distance of [8,16,32,64])
        add('boat',`travel_${direction}_${distance}`,`Steer the boat ${distance} blocks ${direction}`,(signal)=>this.travelBoat(dx,dz,distance,signal),1,'travel','Travel by boat');
      add('boat','dismount','Dismount the current boat',()=>this.bot.dismount(),1,'dismount','Leave the boat');
      return true;
    }
    return false;
  }

  addCandidates(state,add,{placements=[]}={}) {
    const bot=this.bot;
    const dimension=state.dimension;

    const containers=this.blockPositions(containerBlock,16,4);
    for(const p of containers) {
      const block=bot.blockAt(p);const key=this.containerKey(dimension,p);const view=this.memory.containerViews?.[key];
      const contents=view ? Object.entries(view.contents).map(([name,count])=>`${name} x${count}`).join(', ') || 'empty' : 'unknown';
      add('container',`inspect_${idAt(p)}`,`Inspect ${block.name} at ${p}; last known contents: ${contents}`,()=>this.inspectContainer(dimension,p),1,'inspect','Inspect container contents');
      for(const [name,count] of Object.entries(state.inventory || {}))add('container',`deposit_${name}_${idAt(p)}`,`Deposit ${name} into ${block.name} at ${p}; holding ${count}`,(signal,quantity)=>this.transferContainer(dimension,p,name,'deposit',quantity),Math.min(64,count),'deposit','Deposit an inventory item');
      for(const [name,count] of Object.entries(view?.contents || {}))add('container',`withdraw_${name}_${idAt(p)}`,`Withdraw ${name} from ${block.name} at ${p}; last observed ${count}`,(signal,quantity)=>this.transferContainer(dimension,p,name,'withdraw',quantity),Math.min(64,count),'withdraw','Withdraw a stored item');
    }

    for(const observed of (state.entities || []).filter(e=>e.name==='villager').slice(0,8)) {
      const entity=bot.entities[observed.id];if(!entity)continue;
      const view=this.memory.tradeViews?.[this.tradeKey(dimension,entity)];
      add('trade',`inspect_${observed.id}`,`Inspect villager ${observed.id}'s current offers`,()=>this.inspectTrades(dimension,observed.id),1,'inspect','Inspect villager offers');
      for(const offer of view?.offers || []) {
        if(offer.disabled || !offer.remaining)continue;
        const first=Math.floor((state.inventory?.[offer.input1.name] || 0)/offer.input1.count);
        const second=offer.input2 ? Math.floor((state.inventory?.[offer.input2.name] || 0)/offer.input2.count) : Infinity;
        const possible=Math.min(first,second,offer.remaining);
        if(possible<1)continue;
        const price=`${offer.input1.count} ${offer.input1.name}${offer.input2?` + ${offer.input2.count} ${offer.input2.name}`:''}`;
        add('trade',`execute_${observed.id}_${offer.index}`,`Trade ${price} for ${offer.output.count} ${offer.output.name}; up to ${possible} times`,(signal,quantity)=>this.executeTrade(dimension,observed.id,offer.index,quantity),Math.min(64,possible),'execute','Execute an affordable villager trade');
      }
    }

    const night=bot.time?.timeOfDay>=12541 && bot.time?.timeOfDay<=23458;
    if(/overworld/.test(dimension) && (night || (bot.isRaining && bot.thunderState>0)))for(const p of this.blockPositions(b=>bot.isABed?.(b),32,6))
      add('sleep',`bed_${idAt(p)}`,`Sleep in ${bot.blockAt(p).name} at ${p}`,()=>this.sleepIn(p));

    const water=this.blockPositions(b=>b.name==='water',16,12);
    if(bot.entity.isInWater) {
      for(const [direction,dx,dz] of horizontalDirections)for(const distance of [2,4,8,16])
        add('swim',`${direction}_${distance}`,`Swim ${distance} blocks ${direction}`,(signal)=>this.swimHorizontal(dx,dz,distance,signal),1,'horizontal','Swim horizontally');
      for(const distance of [1,2,4])add('swim',`dive_${distance}`,`Dive ${distance} blocks downward`,signal=>this.swimVertical('dive',distance,signal),1,'dive','Dive underwater');
      add('swim','surface','Swim upward until reaching the surface',signal=>this.swimVertical('surface',8,signal),1,'surface','Surface from water');
    } else for(const p of water.slice(0,4))add('swim',`enter_${idAt(p)}`,`Enter water at ${p}`,()=>this.enterWater(p),1,'enter','Enter nearby water');

    const boats=bot.inventory.items().filter(i=>/_(boat|raft)$/.test(i.name));
    for(const item of boats)for(const p of water.filter(p=>air(bot.blockAt(p.offset(0,1,0)))).slice(0,4))
      add('boat',`launch_${item.name}_${idAt(p)}`,`Launch ${item.name} on water at ${p}`,()=>this.launchBoat(item.name,p),1,'launch','Launch a boat');
    for(const entity of state.entities || [])if(boatEntity(entity))add('boat',`mount_${entity.id}`,`Mount ${entity.name} ${entity.id} at ${JSON.stringify(entity.position)}`,()=>this.mountBoat(entity.id),1,'mount','Mount a nearby boat');

    const cropPositions=this.blockPositions(b=>b.name in matureAge || /^(melon|pumpkin)$/.test(b.name),16,24);
    const plantingPositions=this.blockPositions(b=>/^(farmland|soul_sand)$/.test(b.name),16,16);
    const tillingPositions=this.blockPositions(b=>/^(dirt|grass_block|coarse_dirt|rooted_dirt)$/.test(b.name),16,16);
    const farmBlocks=[...new Map([...cropPositions,...plantingPositions,...tillingPositions].map(p=>[p.toString(),p])).values()];
    const hoe=bot.inventory.items().find(i=>/_hoe$/.test(i.name));
    for(const p of farmBlocks) {
      const block=bot.blockAt(p);const props=properties(block);const maximum=matureAge[block.name];
      if(/^(melon|pumpkin)$/.test(block.name) || (maximum!==undefined && Number(props.age)>=maximum))
        add('farm',`harvest_${idAt(p)}`,`Harvest mature ${block.name} at ${p}`,()=>this.harvest(p),1,'harvest','Harvest mature crops');
      else if(maximum!==undefined && state.inventory?.bone_meal)
        add('farm',`fertilize_${idAt(p)}`,`Use bone meal on immature ${block.name} at ${p}`,()=>this.fertilize(p),1,'fertilize','Fertilize an immature crop');
      if(hoe && /^(dirt|grass_block|coarse_dirt|rooted_dirt)$/.test(block.name) && air(bot.blockAt(p.offset(0,1,0))))
        add('farm',`till_${idAt(p)}`,`Till ${block.name} at ${p} using ${hoe.name}`,()=>this.till(p,hoe.name),1,'till','Prepare farmland');
      for(const itemName of plantable[block.name] || [])if(state.inventory?.[itemName] && air(bot.blockAt(p.offset(0,1,0))))
        add('farm',`plant_${itemName}_${idAt(p)}`,`Plant ${itemName} on ${block.name} at ${p}`,()=>this.plant(p,itemName),1,'plant','Plant a crop');
    }

    if(state.inventory?.bucket) {
      for(const fluid of ['water','lava','powder_snow'])for(const p of this.blockPositions(b=>b.name===fluid,12,8)) {
        const level=properties(bot.blockAt(p)).level;
        if(level===undefined || Number(level)===0)add('bucket',`collect_${fluid}_${idAt(p)}`,`Collect ${fluid} source at ${p} with a bucket`,()=>this.collectBucket(p,fluid),1,'collect','Fill an empty bucket');
      }
      for(const entity of state.entities || [])if(/^(cow|goat|mooshroom)$/.test(entity.name))
        add('bucket',`milk_${entity.id}`,`Milk ${entity.name} ${entity.id} with a bucket`,()=>this.milk(entity.id),1,'milk','Collect milk from an animal');
    }
    for(const item of bot.inventory.items().filter(i=>fluidBucket(i.name)))for(const p of placements.slice(0,4))
      add('bucket',`empty_${item.name}_${idAt(p)}`,`Empty ${item.name} at ${p}`,()=>this.emptyBucket(item.name,p),1,'empty','Empty a filled bucket');

    const origin=bot.entity.position.floored();
    const allowedX=Array.from({length:129},(_,index)=>origin.x+index-64);
    const allowedZ=Array.from({length:129},(_,index)=>origin.z+index-64);
    add('coordinate_move','local',`Move to any exact X/Z coordinate within 64 blocks of (${origin.x}, ${origin.z}); Pathfinder chooses viable terrain height`,(signal,quantity,parameters)=>this.moveCoordinate(parameters,allowedX,allowedZ),1,undefined,undefined,
      {coordinateOptions:{origin:{x:origin.x,z:origin.z},x:allowedX,z:allowedZ}});
  }
}

export { containerBlock };
