import pathfinderPackage from 'mineflayer-pathfinder';
import vec3Package from 'vec3';
import { setTimeout as sleep } from 'node:timers/promises';
import { desiredCrafts, count } from './strategy.js';
import { edible, hostile } from './world.js';
import { navigate } from './navigation.js';
import { woodSupply, resourceTargets, goalRecipeGuidance } from './resources.js';
const { goals } = pathfinderPackage;
const { Vec3 } = vec3Package;
const v = p => new Vec3(p.x, p.y, p.z);

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
  async smelt(raw, fuel) {
    const b = this.block('furnace');
    await this.near(b.position);
    const furnace = await this.bot.openFurnace(b);
    try {
      if (furnace.outputItem()) await furnace.takeOutput();
      if (!furnace.inputItem() && this.item(raw)) await furnace.putInput(this.item(raw).type, null, Math.min(8, this.item(raw).count));
      if (furnace.fuel <= 0 && !furnace.fuelItem() && this.item(fuel)) await furnace.putFuel(this.item(fuel).type, null, Math.min(2, this.item(fuel).count));
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
  portalSite() {
    const p = this.bot.entity.position.floored();
    for (const [dx,dz] of [[3,0],[-5,0],[0,3],[0,-3]]) {
      const base = p.offset(dx,-1,dz);
      let clear = true;
      for (let x = 0; x < 4; x++) {
        if (this.bot.blockAt(base.offset(x,0,0))?.boundingBox !== 'block') clear = false;
        for (let y = 1; y <= 5; y++) if (this.bot.blockAt(base.offset(x,y,0))?.name !== 'air') clear = false;
      }
      if (clear) return base.offset(0,1,0);
    }
    return null;
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
    const add = (id, description, run) => {
      const retry = this.memory.failures?.[`${s.dimension}:${id}`]?.retryAfter || 0;
      if (Math.max(this.cooldowns.get(id) || 0, retry) <= Date.now()) out.push({ id, description, run });
    };
    const n = name => s.inventory[name] || 0;
    const food = this.item(edible);
    if (food && bot.food < 19) add('eat', `Eat ${food.name} to restore hunger`, async () => { await this.equip(food.name); await bot.consume(); });
    const danger = s.entities.find(e => hostile.test(e.name) && e.distance < 10);
    if (danger) add('flee', `Move away from nearby ${danger.name}`, async () => {
      await navigate(bot, new goals.GoalInvert(new goals.GoalNear(danger.position.x, danger.position.y, danger.position.z, 14)));
    });
    for (const [suffix, destination] of [['helmet','head'],['chestplate','torso'],['leggings','legs'],['boots','feet']]) {
      const armor = this.item(new RegExp(`^(diamond|iron|golden|leather)_${suffix}$`));
      if (armor && !s.equipped.includes(armor.name)) add(`equip_${suffix}`, `Equip ${armor.name}`, () => bot.equip(armor, destination));
    }
    const table = this.block('crafting_table');
    s.goalRecipeGuidance = goalRecipeGuidance(bot,s);
    const tableUseful = desiredCrafts(s).some(name => {
      const id = bot.registry.itemsByName[name]?.id;
      return id !== undefined && bot.recipesFor(id,null,1,true).some(r=>r.requiresTable);
    });
    for (const landmark of s.memory?.knownPlaces || []) {
      if (!['crafting_table','furnace','nether_portal'].includes(landmark.name)) continue;
      if (landmark.name === 'crafting_table' && !tableUseful) continue;
      if (this.block(landmark.name)) continue;
      const p = landmark.position;
      add(`revisit_${landmark.name}_${p.x}_${p.z}`, `Return to last-seen ${landmark.name} at ${JSON.stringify(p)}; verify it still exists`, () => this.near(p, 3));
    }
    for (const name of desiredCrafts(s)) {
      const type = bot.registry.itemsByName[name]?.id;
      if (type && bot.recipesFor(type, null, 1, table).length) add(`craft_${name}`, `Craft ${name} for progression`, () => this.craft(name));
    }
    for (const name of ['crafting_table', 'furnace']) {
      const position = this.placement();
      if (n(name) && (name !== 'crafting_table' || tableUseful) && !this.block(name) && position) add(`place_${name}`, `Place ${name} for crafting or smelting`, () => this.place(name, position));
    }
    const fuel = this.item(/^(coal|charcoal)$|_planks$/);
    const raw = this.item(/^(raw_iron|iron_ore|deepslate_iron_ore|beef|porkchop|chicken|mutton|potato)$/);
    if (this.block('furnace')) add('smelt', 'Collect furnace output, add raw iron or food and fuel if available', () => this.smelt(raw?.name, fuel?.name));

    const resources = [];
    if (woodSupply(s.inventory) < 16) resources.push(/_log$|_stem$/);
    if (n('cobblestone') < 32) resources.push(/^(stone|cobblestone)$/);
    if (n('coal') < 16) resources.push(/^(coal_ore|deepslate_coal_ore)$/);
    if (n('iron_ingot') + n('raw_iron') < 32) resources.push(/^(iron_ore|deepslate_iron_ore)$/);
    if (!n('diamond_pickaxe') && n('diamond') < 3) resources.push(/^(diamond_ore|deepslate_diamond_ore)$/);
    if (n('diamond_pickaxe') && n('obsidian') < 10) resources.push(/^obsidian$/);
    if (n('flint') < (n('bow') ? 12 : 1)) resources.push(/^gravel$/);
    if (s.foodItems < 12) resources.push(/^hay_block$/);
    for (const matcher of resources) {
      for (const {block:b,visible} of resourceTargets(bot,matcher)) {
        const p=b.position;
        if (visible) add(`mine_${p.x}_${p.y}_${p.z}`, `Mine ${b.name} at ${p}; distance ${Math.round(bot.entity.position.distanceTo(p))}`, () => this.mine(p));
        else add(`approach_${p.x}_${p.y}_${p.z}`, `Approach exposed ${b.name} at ${p} using existing open terrain; do not dig. Mine after it is visible.`, () => this.near(p));
      }
    }

    if (n('hay_block') && bot.recipesFor(bot.registry.itemsByName.wheat.id, null, 1, table).length) add('craft_wheat', 'Turn hay into wheat for bread', () => this.craft('wheat'));
    for (const e of s.entities) {
      if (e.name === 'item' && e.distance < 16) add(`collect_${e.id}`, `Pick up dropped item at distance ${e.distance}`, async () => {
        const entity = bot.entities[e.id];
        if (entity) await this.near(entity.position, 1);
      });
      const prey = /^(cow|pig|sheep|chicken)$/.test(e.name) && s.foodItems < 16;
      const needed = (e.name === 'blaze' && n('blaze_rod') < 7) || (e.name === 'enderman' && n('ender_pearl') + n('ender_eye') < 14 && bot.health >= 16);
      if (e.distance < 24 && (prey || needed || (e.hostile && e.distance < 6) || (e.name === 'ender_dragon' && e.distance < 5))) add(`fight_${e.id}`, `Fight ${e.name} at distance ${e.distance}; health ${s.health}`, signal => this.fight(e.id, signal));
      if (n('bow') && n('arrow') && /^(end_crystal|ender_crystal|ender_dragon|blaze|ghast)$/.test(e.name)) add(`shoot_${e.id}`, `Shoot bow at ${e.name}, distance ${e.distance}`, signal => this.shoot(e.id, signal));
    }
    const portal = this.block('nether_portal');
    const nether = s.dimension.includes('nether');
    const rodsReady = n('blaze_rod') * 2 + n('blaze_powder') + n('ender_eye') >= 14;
    if (portal) {
      this.memory.portals[s.dimension] = portal.position;
      if ((nether && rodsReady) || (!nether && !rodsReady)) add('enter_nether_portal', 'Walk inside the Nether portal and wait for dimension transfer', async signal => {
        await this.near(portal.position, 0);
        await sleep(5000, undefined, { signal });
      });
    } else if (nether && rodsReady && this.memory.portals[s.dimension]) {
      add('return_portal', 'Return to the remembered Nether entrance', () => this.near(this.memory.portals[s.dimension], 2));
    }
    if (!nether && !s.dimension.includes('end') && !portal && !rodsReady) {
      if (!this.memory.portalBuild && n('obsidian') >= 10) this.memory.portalBuild = this.portalSite();
      const p = this.memory.portalBuild;
      if (p) {
        const positions = [[0,0,'cobblestone'],[1,0,'obsidian'],[2,0,'obsidian'],[3,0,'cobblestone'],[0,1,'obsidian'],[3,1,'obsidian'],[0,2,'obsidian'],[3,2,'obsidian'],[0,3,'obsidian'],[3,3,'obsidian'],[0,4,'cobblestone'],[1,4,'obsidian'],[2,4,'obsidian']].map(([x,y,name]) => ({ p: v(p).offset(x,y,0), name }));
        const missing = positions.find(q => bot.blockAt(q.p)?.name !== q.name);
        if (missing && n(missing.name)) add('build_portal', `Place next ${missing.name} in portal frame at ${missing.p}`, () => this.place(missing.name, missing.p));
        if (!missing && n('flint_and_steel')) add('light_portal', 'Light the completed obsidian portal', async () => {
          await this.near(v(p).offset(1,1,0), 3); await this.equip('flint_and_steel');
          await bot.activateBlock(bot.blockAt(v(p).offset(1,0,0)), new Vec3(0,1,0));
        });
      }
    }
    const endPortal = this.block('end_portal');
    if (endPortal && !s.dimension.includes('end')) add('enter_end', 'Enter the active End portal', () => this.near(endPortal.position, 0));
    const frames = bot.findBlocks({ matching: b => b.name === 'end_portal_frame' && !b.getProperties().eye, maxDistance: 32, count: 12 });
    if (n('ender_eye') && !nether && !s.dimension.includes('end')) {
      if (frames.length) add('fill_frame', 'Insert Eye of Ender in an empty portal frame', async () => {
        await this.near(frames[0]); await this.equip('ender_eye'); await bot.activateBlock(bot.blockAt(frames[0]), new Vec3(0,1,0));
      });
      else if (n('ender_eye') >= 1 && (rodsReady || this.memory.eyeTarget)) {
        add('throw_eye', 'Throw an Eye of Ender to locate the stronghold; consumes an eye if it breaks', signal => this.eye(signal));
        if (this.memory.eyeTarget) add('follow_eye', 'Move toward the last observed Eye of Ender trajectory', async () => {
          const p = this.memory.eyeTarget;
          if (p.descending) await this.near(p, 2);
          else await navigate(bot, new goals.GoalNearXZ(p.x, p.z, 3));
          this.memory.eyeTarget = null;
        });
      }
    }
    // Exploration uses loaded blocks only, with remembered visits to avoid short loops.
    const feet = bot.entity.position.floored();
    for (const [label, dx,dz] of [['north',0,-20],['east',20,0],['south',0,20],['west',-20,0]]) {
      const key = `${s.dimension}:${Math.floor((feet.x + dx)/16)},${Math.floor((feet.z + dz)/16)}`;
      add(`explore_${label}`, `Explore ${label} 20 blocks; previous visits ${this.memory.visits[key] || 0}`, async () => {
        this.memory.visits[key] = (this.memory.visits[key] || 0) + 1;
        await navigate(bot, new goals.GoalNearXZ(feet.x + dx, feet.z + dz, 3));
      });
    }
    return out;
  }
}
