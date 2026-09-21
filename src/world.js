import { count, objective } from './strategy.js';
import { rememberBlock, updateMemory, memoryContext } from './memory.js';
import { Vec3 } from 'vec3';

export const hostile = /^(zombie|husk|drowned|skeleton|stray|wither_skeleton|creeper|spider|cave_spider|blaze|ghast|magma_cube|piglin_brute|silverfish)$/;
export const edible = /^(bread|cooked_beef|cooked_porkchop|cooked_chicken|cooked_mutton|cooked_rabbit|baked_potato|apple|carrot|melon_slice|beef|porkchop|mutton|sweet_berries)$/;
export const vec = p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 });

export function observe(bot, memory) {
  const inventory = {};
  for (const item of bot.inventory.items()) inventory[item.name] = (inventory[item.name] || 0) + item.count;
  const entities = Object.values(bot.entities).filter(e => e.id !== bot.entity.id && e.position && bot.entity.position.distanceTo(e.position) < 48)
    .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)).slice(0, 24);
  const find = name => bot.findBlock({ matching: b => b.name === name, maxDistance: 32 });
  const s = {
    dimension: String(bot.game.dimension), position: vec(bot.entity.position), health: bot.health, food: bot.food,
    time: bot.time.timeOfDay, inventory,
    inWater:!!bot.entity.isInWater, isSleeping:!!bot.isSleeping, vehicle:bot.vehicle?.name || null,
    heldItem: bot.heldItem?.name || null,
    equipped: [5, 6, 7, 8].map(slot => bot.inventory.slots[slot]?.name).filter(Boolean),
    entities: entities.map(e => ({ id: e.id, name: e.name, position: vec(e.position), distance: Math.round(bot.entity.position.distanceTo(e.position)), hostile: hostile.test(e.name) })),
    tableNearby: !!find('crafting_table'), furnaceNearby: !!find('furnace'),
    netherPortal: !!find('nether_portal'),
    eyeTarget: memory.eyeTarget, elapsedSeconds: Math.floor((Date.now() - memory.started) / 1000)
  };
  s.objective = objective(s);
  s.foodItems = count(inventory, edible);
  const landmarks = bot.findBlocks({ matching: b => /^(crafting_table|furnace|nether_portal|end_portal|end_portal_frame|spawner|chest|diamond_ore|deepslate_diamond_ore|obsidian)$/.test(b.name), maxDistance: 32, count: 24 });
  s.observedBlocks = [...new Set(landmarks.map(p => bot.blockAt(p)?.name).filter(Boolean))];
  for (const p of landmarks) rememberBlock(memory, s.dimension, bot.blockAt(p));
  for (const place of Object.values(memory.landmarks)) {
    if (place.dimension !== s.dimension) continue;
    const { x, y, z } = place.position;
    const current = bot.blockAt(new Vec3(x,y,z));
    if (current) rememberBlock(memory, s.dimension, current);
  }
  updateMemory(memory, s);
  s.memory = memoryContext(memory, s);
  return s;
}
