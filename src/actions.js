import pathfinderPackage from 'mineflayer-pathfinder';
import vec3Package from 'vec3';
import { setTimeout as sleep } from 'node:timers/promises';
import { navigate } from './navigation.js';
import { explorationOptions, loopSummary } from './exploration.js';
import { goalRecipeGuidance } from './resources.js';
const { goals } = pathfinderPackage;
const { Vec3 } = vec3Package;
const v = p => new Vec3(p.x, p.y, p.z);
const air = block => !block || /^(air|cave_air|void_air)$/.test(block.name);
const protectedBlock = block => /^(obsidian|crafting_table|furnace|end_portal_frame|nether_portal|end_portal|chest|barrel|spawner)$/.test(block?.name || '');
const neighbors = [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,1,0),new Vec3(0,-1,0),new Vec3(0,0,1),new Vec3(0,0,-1)];

export class Actions {
  constructor(bot, memory) { this.bot = bot; this.memory = memory; this.cooldowns = new Map(); }
  item(name) { return this.bot.inventory.items().find(i => typeof name === 'string' ? i.name === name : name.test(i.name)); }
  block(name, distance = 32) { return this.bot.findBlock({ matching: b => typeof name === 'string' ? b.name === name : name.test(b.name), maxDistance: distance }); }
  async near(position, range = 2) {
    this.signal?.throwIfAborted();
    await navigate(this.bot, new goals.GoalNear(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z), range));
    this.signal?.throwIfAborted();
  }
  async equip(name) {
    this.signal?.throwIfAborted();
    const item = this.item(name);
    if (!item) throw new Error(`Missing ${name}`);
    await this.bot.equip(item, 'hand');
    this.signal?.throwIfAborted();
  }
  async tool(block) {
    const tools = this.bot.inventory.items().filter(i => /pickaxe|axe|shovel/.test(i.name));
    const best = tools.filter(i => block.canHarvest(i.type)).sort((a, b) => block.digTime(a.type, false, false, false) - block.digTime(b.type, false, false, false))[0];
    if (best) await this.bot.equip(best, 'hand');
    if (!block.canHarvest(this.bot.heldItem?.type ?? null)) throw new Error('No suitable harvest tool');
  }
  async mine(position) {
    await this.near(position);
    const b = this.bot.blockAt(v(position));
    if (!b || b.name === 'air') throw new Error('Block disappeared');
    await this.tool(b);
    this.signal?.throwIfAborted();
    if (!this.bot.canDigBlock(b)) throw new Error('Block out of reach');
    // Never mine a block touching lava or directly underneath the bot.
    const feet = this.bot.entity.position.floored();
    if (feet.x === b.position.x && feet.z === b.position.z && b.position.y < feet.y) throw new Error('Unsafe block underfoot');
    for (const d of [new Vec3(1,0,0), new Vec3(-1,0,0), new Vec3(0,1,0), new Vec3(0,0,1), new Vec3(0,0,-1)]) {
      if (this.bot.blockAt(b.position.plus(d))?.name === 'lava') throw new Error('Lava adjacent to block');
    }
    await this.bot.dig(b);
    this.signal?.throwIfAborted();
    await this.near(position, 1);
  }
  harvestable(block) {
    return !!block?.diggable && (block.canHarvest(null) || this.bot.inventory.items().some(i=>block.canHarvest(i.type)));
  }
  safeExcavationBlock(block) {
    return air(block) || (block.boundingBox==='block' && !protectedBlock(block) && this.harvestable(block) &&
      !neighbors.some(d=>/lava/.test(this.bot.blockAt(block.position.plus(d))?.name || '')));
  }
  async digExcavationBlock(block) {
    if (air(block)) return;
    if (!this.safeExcavationBlock(block)) throw new Error(`Unsafe excavation block: ${block?.name || 'unknown'}`);
    await this.tool(block);
    this.signal?.throwIfAborted();
    if (!this.bot.canDigBlock(block)) throw new Error('Excavation block out of reach');
    await this.bot.dig(block);
    this.signal?.throwIfAborted();
  }
  async excavate(destination) {
    const p=v(destination);
    const clearance=[p,p.offset(0,1,0)];
    // Recheck after every pass because sand or gravel may fall into the opening.
    for(let pass=0;pass<4;pass++) {
      const blocking=clearance.map(q=>this.bot.blockAt(q)).filter(b=>!air(b));
      if(!blocking.length) break;
      for(const block of blocking.reverse()) await this.digExcavationBlock(block);
    }
    if(clearance.some(q=>!air(this.bot.blockAt(q)))) throw new Error('Excavation did not leave a clear passage');
    const support=this.bot.blockAt(p.offset(0,-1,0));
    if(support?.boundingBox!=='block' || /lava/.test(support.name)) throw new Error('Excavation destination has unsafe footing');
    await navigate(this.bot,new goals.GoalBlock(p.x,p.y,p.z),5000);
  }
  async interactEntity(id) {
    const initial=this.bot.entities[id];
    if(!initial?.position) throw new Error('Entity disappeared');
    await this.near(initial.position,2);
    const entity=this.bot.entities[id];
    if(!entity?.isValid) throw new Error('Entity disappeared');
    await this.bot.activateEntity(entity);
  }
  async place(name, position) {
    const p = v(position);
    if (this.bot.blockAt(p)?.boundingBox !== 'empty') throw new Error('Placement space occupied');
    await this.near(p, 3);
    await this.equip(name);
    for (const d of [new Vec3(0,-1,0), new Vec3(-1,0,0), new Vec3(1,0,0), new Vec3(0,0,-1), new Vec3(0,0,1), new Vec3(0,1,0)]) {
      const ref = this.bot.blockAt(p.plus(d));
      if (ref?.boundingBox === 'block') { await this.bot.placeBlock(ref, d.scaled(-1)); return; }
    }
    throw new Error('No support for placement');
  }
  placement() {
    const p = this.bot.entity.position.floored();
    for (const [x,z] of [[2,0],[-2,0],[0,2],[0,-2],[1,1],[-1,-1]]) {
      const q = p.offset(x,0,z);
      if (this.bot.blockAt(q)?.name === 'air' && this.bot.blockAt(q.offset(0,-1,0))?.boundingBox === 'block') return q;
    }
    return null;
  }
  async craft(name) {
    this.signal?.throwIfAborted();
    const type = this.bot.registry.itemsByName[name]?.id;
    let table = null;
    let recipe = this.bot.recipesFor(type, null, 1, null)[0];
    if (!recipe) {
      table = this.block('crafting_table');
      if (!table) throw new Error(`Crafting table required for ${name}`);
      await this.near(table.position);
      table = this.bot.blockAt(table.position);
      if (table?.name !== 'crafting_table') throw new Error('Crafting table disappeared');
      recipe = this.bot.recipesFor(type, null, 1, table)[0];
    }
    if (!recipe) throw new Error(`Recipe no longer available: ${name}`);
    this.signal?.throwIfAborted();
    await this.bot.craft(recipe, 1, table);
  }
  async smelt(raw, fuel, quantity = 1) {
    const b = this.block('furnace');
    await this.near(b.position);
    const furnace = await this.bot.openFurnace(b);
    try {
      if (furnace.outputItem()) await furnace.takeOutput();
      if (!furnace.inputItem() && this.item(raw)) await furnace.putInput(this.item(raw).type, null, Math.min(quantity, this.item(raw).count));
      if (furnace.fuel <= 0 && !furnace.fuelItem() && this.item(fuel)) await furnace.putFuel(this.item(fuel).type, null, Math.min(quantity, this.item(fuel).count));
    } finally { furnace.close(); }
    this.cooldowns.set('smelt', Date.now() + 12000);
  }
  async fight(id, signal) {
    const bot = this.bot;
    const weapon = this.item(/diamond_sword|iron_sword|stone_sword|wooden_sword|_axe$/);
    if (weapon) await bot.equip(weapon, 'hand');
    const deadline = Date.now() + 7000;
    try {
      while (Date.now() < deadline && !signal.aborted) {
        const target = bot.entities[id];
        if (!target?.isValid || bot.health <= 6) break;
        if (target.name === 'creeper' && bot.entity.position.distanceTo(target.position) < 3) break;
        if (bot.entity.position.distanceTo(target.position) > 3) bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
        else {
          bot.pathfinder.setGoal(null);
          await bot.lookAt(target.position.offset(0, Math.min(target.height || 1, 1.5), 0));
          bot.attack(target);
        }
        await sleep(650, undefined, { signal });
      }
    } finally { bot.pathfinder.setGoal(null); }
  }
  async shoot(id, signal) {
    const target = this.bot.entities[id];
    if (!target) throw new Error('Target disappeared');
    await this.equip('bow');
    const p = target.position.offset(0, (target.height || 1) / 2, 0);
    const d = this.bot.entity.position.distanceTo(p);
    // Approximate full-charge arrow gravity compensation; moving targets may miss.
    await this.bot.lookAt(p.offset(0, 0.003 * d * d, 0));
    this.bot.activateItem();
    try { await sleep(1100, undefined, { signal }); }
    finally { this.bot.deactivateItem(); }
  }
  async eye(signal) {
    let start, last;
    const track = e => {
      if (/eye_of_ender|ender_signal/.test(e.name || '') && e.position.distanceTo(this.bot.entity.position) < 32) {
        start ||= e.position.clone(); last = e.position.clone();
      }
    };
    this.bot.on('entitySpawn', track); this.bot.on('entityMoved', track);
    try {
      await this.equip('ender_eye'); this.bot.activateItem();
      await sleep(1800, undefined, { signal });
      if (!last || !start || last.distanceTo(start) < 1) throw new Error('Eye trajectory was not observed');
      const direction = last.minus(start);
      const length = Math.hypot(direction.x, direction.z);
      const descending = direction.y < -1;
      const scale = !descending && length > 1 ? 32 / length : 0;
      this.memory.eyeTarget = { x: Math.round(last.x + direction.x * scale), y: Math.round(last.y), z: Math.round(last.z + direction.z * scale), descending };
      this.cooldowns.set('throw_eye', Date.now() + 20000);
    } finally {
      this.bot.deactivateItem(); this.bot.removeListener('entitySpawn', track); this.bot.removeListener('entityMoved', track);
    }
  }

  candidates(s) {
    const bot = this.bot;
    const out = [];
    const add = (skill, target, description, run, maxQuantity = 1) => {
      const id = `${skill}_${target}`;
      const retry = this.memory.failures?.[`${s.dimension}:${id}`]?.retryAfter || 0;
      const interactionState=skill==='interact' ? `${bot.blockAt(new Vec3(...String(target).split('_').map(Number)))?.stateId}:${bot.heldItem?.name || 'empty'}` :
        skill==='interact_entity' ? `${target}:${bot.heldItem?.name || 'empty'}` : undefined;
      const repeats=(this.memory.recent || []).filter(a=>a.dimension===s.dimension && a.action===id && a.interactionState===interactionState && Date.now()-a.started<60000 && !Object.keys(a.inventoryDelta || {}).length);
      if(interactionState && repeats.length>=2)return false;
      if (Math.max(this.cooldowns.get(id) || 0,retry) <= Date.now()) {out.push({id,skill,description,run,maxQuantity,interactionState});return true;}
      return false;
    };
    s.goalRecipeGuidance = goalRecipeGuidance(bot,s);
    s.exploration = loopSummary(this.memory,s.dimension);
    const table = this.block('crafting_table');
    // Recipe availability is a game mechanic, not a progression wish list.
    for (const item of bot.registry.itemsArray) {
      const recipes = bot.recipesFor(item.id,null,1,table);
      if (recipes.length) add('craft',item.name,`Craft ${item.name}; one batch produces ${recipes[0].result.count}`, async (signal,quantity=1) => {
        for (let i=0;i<quantity;i++) { signal?.throwIfAborted(); await this.craft(item.name); }
      },4);
    }
    const origin=bot.entity.position.floored();
    const placements=[];
    for(let x=-3;x<=3;x++)for(let y=-1;y<=3;y++)for(let z=-3;z<=3;z++){
      const p=origin.offset(x,y,z);
      if(x===0 && z===0 && y<=1)continue;
      if(bot.blockAt(p)?.name==='air' && [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,1,0),new Vec3(0,-1,0),new Vec3(0,0,1),new Vec3(0,0,-1)].some(d=>bot.blockAt(p.plus(d))?.boundingBox==='block'))placements.push(p);
    }
    placements.sort((a,b)=>origin.distanceTo(a)-origin.distanceTo(b));
    for (const item of bot.inventory.items()) {
      add('equip',item.name,`Hold ${item.name}`,()=>bot.equip(item,'hand'));
      if (bot.registry.blocksByName[item.name]) for(const placement of placements.slice(0,24)) {
        add('place',`${item.name}_${placement.x}_${placement.y}_${placement.z}`,`Place ${item.name} at ${placement}`,()=>this.place(item.name,placement));
        if(out.at(-1)?.id===`place_${item.name}_${placement.x}_${placement.y}_${placement.z}`)out.at(-1).parameterGroup=item.name;
      }
      if (bot.registry.foodsByName?.[item.name] && bot.food < 20) add('eat',item.name,`Eat ${item.name}`,async()=>{await this.equip(item.name);await bot.consume();});
      const armorSlot = {helmet:'head',chestplate:'torso',leggings:'legs',boots:'feet'}[item.name.split('_').at(-1)];
      if (armorSlot) add('wear',item.name,`Wear ${item.name}`,()=>bot.equip(item,armorSlot));
      add('use',item.name,`Use held ${item.name}; effect depends on item (no block target)`,async signal=>{
        if (item.name === 'ender_eye') return this.eye(signal);
        await this.equip(item.name);bot.activateItem();
        try { await sleep(1000,undefined,{signal}); } finally {bot.deactivateItem();}
      });
    }
    const feet=bot.entity.position.floored();
    // All visible harvestable block types are eligible, including non-speedrun materials.
    const blocks=bot.findBlocks({maxDistance:16,count:96,
      // Mineflayer calls matching on palette entries, which have no position.
      matching:b=>b?.boundingBox==='block',
      useExtraInfo:b=>!!b?.position && bot.entity.position.distanceTo(b.position)<=16 &&
        !(b.position.x===feet.x && b.position.z===feet.z && b.position.y<feet.y) && bot.canSeeBlock(b)});
    const seen=new Map();
    const approached=new Set();
    for (const p of blocks) {
      const b=bot.blockAt(p);if (!b) continue;
      const count=seen.get(b.name) || 0;
      if (count<3 && this.harvestable(b)) {
        if(add('mine',`${p.x}_${p.y}_${p.z}`,`Mine ${b.name} at ${p}`,()=>this.mine(p)))seen.set(b.name,count+1);
      }
      if(!approached.has(b.name)) {
        add('move',`visible_${b.name}_${p.x}_${p.y}_${p.z}`,`Approach visible ${b.name} at ${p} without mining or activating it`,()=>this.near(p,2));
        approached.add(b.name);
      }
      add('interact',`${p.x}_${p.y}_${p.z}`,`Right-click ${b.name} at ${p} using ${bot.heldItem?.name || 'an empty hand'}`,async()=>{await this.near(p,3);const block=bot.blockAt(p);if(!block)throw new Error('Target unloaded');await bot.activateBlock(block,new Vec3(0,1,0));});
    }
    const passages=[['north',0,-1],['east',1,0],['south',0,1],['west',-1,0]];
    for(const [direction,dx,dz] of passages) for(const [slope,dy] of [['down',-1],['level',0],['up',1]]) {
      const destination=feet.offset(dx,dy,dz);
      const support=bot.blockAt(destination.offset(0,-1,0));
      const clearance=[bot.blockAt(destination),bot.blockAt(destination.offset(0,1,0))];
      const blocking=clearance.filter(b=>!air(b));
      if(support?.boundingBox==='block' && !/lava/.test(support.name) && blocking.length && blocking.every(b=>this.safeExcavationBlock(b))) {
        add('excavate',`${direction}_${slope}`,`Excavate one safe ${slope} step ${direction}; clear a two-block-high passage and move into it`,()=>this.excavate(destination));
      }
    }
    for (const e of s.entities) {
      if(e.name==='item') add('collect',e.id,`Collect dropped item at ${JSON.stringify(e.position)}`,()=>this.near(e.position,1));
      else if(e.name!=='player') {
        add('fight',e.id,`Fight ${e.name} at distance ${e.distance}`,signal=>this.fight(e.id,signal));
        if(this.item('bow') && this.item('arrow')) add('shoot',e.id,`Shoot ${e.name} at distance ${e.distance}`,signal=>this.shoot(e.id,signal));
        if(!e.hostile) add('interact_entity',e.id,`Right-click ${e.name} at distance ${e.distance} using ${bot.heldItem?.name || 'an empty hand'}`,()=>this.interactEntity(e.id));
      }
      if(e.hostile) add('flee',e.id,`Move away from ${e.name}`,()=>navigate(bot,new goals.GoalInvert(new goals.GoalNear(e.position.x,e.position.y,e.position.z,14))));
      add('move',`entity_${e.id}`,`Approach ${e.name} at ${JSON.stringify(e.position)}`,()=>this.near(e.position));
    }
    const places=[...(s.memory?.knownPlaces || [])];
    if(this.memory.eyeTarget)places.push({name:'observed_eye_target',position:this.memory.eyeTarget});
    for(const place of places) {
      const p=place.position;
      add('move',`${place.name}_${p.x}_${p.y}_${p.z}`,`Move to observed ${place.name} at ${JSON.stringify(p)}; may be stale`,()=>this.near(p,place.name.includes('portal')?0:2));
    }
    for(const {label,direction,distanceBlocks,target,revisits,arrivalRadius,timeoutMs} of explorationOptions(this.memory,s)) {
      add('explore',label,`Explore ${distanceBlocks} blocks ${direction} toward (${target.x}, ${target.z}); recent arrival matches ${revisits}`,async()=>{
        await navigate(bot,new goals.GoalNearXZ(target.x,target.z,arrivalRadius),timeoutMs);
      });
    }
    if(this.block('furnace')) {
      add('smelt','collect','Collect furnace output',()=>this.smelt());
      // The agent selects input and fuel independently in the furnace skill.
      for(const item of bot.inventory.items()) {
        add('furnace_input',item.name,`Put ${item.name} into furnace input; furnace validates compatibility`,(signal,quantity=1)=>this.smelt(item.name,undefined,quantity),4);
        add('furnace_fuel',item.name,`Put ${item.name} into furnace fuel; furnace validates compatibility`,(signal,quantity=1)=>this.smelt(undefined,item.name,quantity),4);
      }
    }
    return out;
  }
}
